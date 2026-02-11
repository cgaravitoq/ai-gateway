import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";
import { z } from "zod/v4";
import type { ProviderName } from "@/config/providers.ts";
import { logger } from "@/middleware/logging.ts";
import { modelSelector } from "@/routing/model-selector.ts";
import { providerRegistry } from "@/routing/provider-registry.ts";
import { errorTracker } from "@/services/error-tracker.ts";
import { getTracer } from "@/telemetry/setup.ts";
import type { RankedProvider, RequestMetadata } from "@/types/routing.ts";

/**
 * Lightweight schema for routing-relevant body fields.
 * Uses `.passthrough()` so unrecognized fields are preserved for downstream.
 */
const RoutingBodySchema = z
	.object({
		model: z.string().optional(),
		stream: z.boolean().optional(),
		max_tokens: z.number().optional(),
	})
	.passthrough();

/**
 * Context keys set by the smart-router middleware.
 *
 * Downstream handlers read `selectedProvider` to know which provider/model
 * to use. After the response completes the middleware automatically reports
 * latency and success/failure back to the registry and tracker.
 */
export interface SmartRouterEnv {
	Variables: {
		selectedProvider: RankedProvider;
		/** Timestamp (ms) when the routing decision was made */
		routeStartTime: number;
	};
}

/**
 * Smart routing middleware — replaces the basic static router.
 *
 * Intercepts every `/v1/*` request to select the optimal LLM provider
 * based on the requested model, routing strategy, and live provider health.
 *
 * **Lifecycle:**
 * 1. Parses the `model` field from the JSON request body (gracefully skips
 *    non-JSON bodies so downstream validation can report the error).
 * 2. Builds {@link RequestMetadata} from the body + custom `x-routing-*` headers.
 * 3. Calls `modelSelector.selectProvider()` to pick the best provider.
 * 4. Sets `c.set('selectedProvider', ...)` for downstream handlers.
 * 5. After `next()`: records latency and outcome to the provider registry
 *    and error tracker.
 *
 * @returns Hono middleware handler bound to {@link SmartRouterEnv}.
 */
export function smartRouter(): MiddlewareHandler<SmartRouterEnv> {
	return async (c, next) => {
		// ── 1. Parse request body ────────────────────────────
		// We clone the request so the body is still available for downstream handlers.
		let rawBody: unknown;
		try {
			rawBody = await c.req.json();
		} catch {
			// Not a JSON body — let downstream handle the error
			await next();
			return;
		}

		const parsed = RoutingBodySchema.safeParse(rawBody);
		if (!parsed.success) {
			// Body doesn't match even the minimal schema — let downstream validate
			await next();
			return;
		}

		const body = parsed.data;
		const model = body.model;
		if (!model) {
			// No model field — skip smart routing, let handler deal with validation
			await next();
			return;
		}

		// ── 2. Build RequestMetadata ────────────────────────
		const requestMetadata: RequestMetadata = {
			model,
			stream: body.stream ?? false,
			maxTokens: body.max_tokens,
			routingHints: parseRoutingHints(c),
		};

		// ── 3. Select provider (with tracing) ────────────────
		const startTime = Date.now();

		// Create a child span for routing decision
		const parentSpan = trace.getSpan(context.active());
		const tracer = getTracer();
		const routingSpan = tracer.startSpan(
			"gateway.routing",
			{
				attributes: { "routing.model_requested": model },
			},
			parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined,
		);

		try {
			const selected = await modelSelector.selectProvider(requestMetadata);
			const routingLatencyMs = Date.now() - startTime;

			c.set("selectedProvider", selected);
			c.set("routeStartTime", startTime);

			routingSpan.setAttributes({
				provider: selected.provider,
				model: selected.modelId,
				"routing.strategy": requestMetadata.routingHints?.strategy ?? "balanced",
				"routing.latency_ms": routingLatencyMs,
			});
			routingSpan.setStatus({ code: SpanStatusCode.OK });
			routingSpan.end();

			logger.debug(
				{
					model,
					provider: selected.provider,
					modelId: selected.modelId,
					score: selected.score,
				},
				"smart-router: provider selected",
			);
		} catch (error) {
			routingSpan.setStatus({ code: SpanStatusCode.ERROR });
			if (error instanceof Error) {
				routingSpan.recordException(error);
			}
			routingSpan.end();

			logger.error(
				{
					model,
					error: error instanceof Error ? error.message : String(error),
				},
				"smart-router: provider selection failed",
			);

			return c.json(
				{
					error: {
						message: error instanceof Error ? error.message : "No provider available",
						type: "server_error",
						code: "no_provider_available",
					},
				},
				503,
			);
		}

		// ── 4. Execute downstream handler ───────────────────
		await next();

		// ── 5. Record outcome ───────────────────────────────
		const latencyMs = Date.now() - startTime;
		const selected = c.get("selectedProvider");

		if (selected) {
			const status = c.res.status;
			if (status >= 200 && status < 400) {
				providerRegistry.reportSuccess(selected.provider, selected.modelId, latencyMs);
				errorTracker.recordSuccess(selected.provider);
			} else {
				providerRegistry.reportError(
					selected.provider,
					selected.modelId,
					new Error(`Downstream responded with status ${status}`),
				);

				// Record the failure in the error tracker
				errorTracker.recordError(
					selected.provider,
					status,
					`Downstream responded with status ${status}`,
					false,
				);
			}

			logger.debug(
				{
					provider: selected.provider,
					modelId: selected.modelId,
					latencyMs,
					status,
				},
				"smart-router: request completed",
			);
		}
	};
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Extract optional routing hints from custom request headers.
 *
 * Supported headers:
 * - `x-routing-strategy`: "cost" | "latency" | "balanced" | "capability"
 * - `x-routing-prefer-provider`: explicit provider preference
 * - `x-routing-max-latency-ms`: maximum acceptable latency
 * - `x-routing-max-cost`: maximum cost per 1K tokens
 */
function parseRoutingHints(c: Parameters<MiddlewareHandler>[0]): RequestMetadata["routingHints"] {
	const strategyHeader = c.req.header("x-routing-strategy");
	const preferProvider = c.req.header("x-routing-prefer-provider");
	const maxLatency = c.req.header("x-routing-max-latency-ms");
	const maxCost = c.req.header("x-routing-max-cost");

	// Only build the object if at least one header is present
	if (!strategyHeader && !preferProvider && !maxLatency && !maxCost) {
		return undefined;
	}

	return {
		strategy: isValidStrategy(strategyHeader) ? strategyHeader : undefined,
		preferProvider: preferProvider as ProviderName | undefined,
		maxLatencyMs: maxLatency ? Number(maxLatency) : undefined,
		maxCostPer1kTokens: maxCost ? Number(maxCost) : undefined,
	};
}

/**
 * Type guard that narrows an unknown value to one of the supported routing strategies.
 *
 * Used to safely validate the `x-routing-strategy` header before passing it
 * into the routing engine.
 */
function isValidStrategy(value: unknown): value is "cost" | "latency" | "balanced" | "capability" {
	return typeof value === "string" && ["cost", "latency", "balanced", "capability"].includes(value);
}
