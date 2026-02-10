import type { MiddlewareHandler } from "hono";
import type { ProviderName } from "@/config/providers.ts";
import { logger } from "@/middleware/logging.ts";
import { modelSelector } from "@/routing/model-selector.ts";
import { providerRegistry } from "@/routing/provider-registry.ts";
import { errorTracker } from "@/services/error-tracker.ts";
import type { RankedProvider, RequestMetadata } from "@/types/routing.ts";

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
 * 1. Parses the `model` field from the JSON request body.
 * 2. Builds `RequestMetadata` from the body + request headers.
 * 3. Calls `modelSelector.selectProvider()` to pick the best provider.
 * 4. Sets `c.set('selectedProvider', ...)` for downstream handlers.
 * 5. After `next()`: records latency and outcome to the provider registry.
 */
export function smartRouter(): MiddlewareHandler<SmartRouterEnv> {
	return async (c, next) => {
		// ── 1. Parse request body ────────────────────────────
		// We clone the request so the body is still available for downstream handlers.
		let body: Record<string, unknown>;
		try {
			body = await c.req.json();
		} catch {
			// Not a JSON body — let downstream handle the error
			await next();
			return;
		}

		const model = typeof body.model === "string" ? body.model : undefined;
		if (!model) {
			// No model field — skip smart routing, let handler deal with validation
			await next();
			return;
		}

		// ── 2. Build RequestMetadata ────────────────────────
		const requestMetadata: RequestMetadata = {
			model,
			stream: body.stream === true,
			maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
			routingHints: parseRoutingHints(c),
		};

		// ── 3. Select provider ──────────────────────────────
		const startTime = Date.now();

		try {
			const selected = await modelSelector.selectProvider(requestMetadata);

			c.set("selectedProvider", selected);
			c.set("routeStartTime", startTime);

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

function isValidStrategy(value: unknown): value is "cost" | "latency" | "balanced" | "capability" {
	return typeof value === "string" && ["cost", "latency", "balanced", "capability"].includes(value);
}
