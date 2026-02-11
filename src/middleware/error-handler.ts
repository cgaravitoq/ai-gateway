import { APICallError } from "ai";
import type { ErrorHandler } from "hono";
import { env } from "@/config/env.ts";
import { PROVIDER_NAMES, type ProviderName } from "@/config/providers.ts";
import { FallbackTimeoutError } from "@/routing/fallback-handler.ts";
import { errorTracker } from "@/services/error-tracker.ts";
import type { GatewayError } from "@/types/index.ts";
import type { RankedProvider } from "@/types/routing.ts";
import { logger } from "./logging.ts";

// ── Helpers ──────────────────────────────────────────────

/** Record an error to the error tracker, resolving the provider from context or error. */
function trackError(
	provider: ProviderName | "unknown",
	statusCode: number,
	message: string,
	isTimeout: boolean,
): void {
	errorTracker.recordError(provider, statusCode, message, isTimeout);
}

/** Resolve the effective provider name from the routing context or an API error. */
function resolveProvider(
	contextProvider: RankedProvider | undefined,
	apiError?: APICallError,
): ProviderName | "unknown" {
	if (contextProvider) return contextProvider.provider;
	if (apiError) return extractProviderFromError(apiError) ?? "unknown";
	return "unknown";
}

// ── Error Handler ────────────────────────────────────────

/**
 * Global Hono error handler that normalizes all errors to OpenAI-compatible JSON format.
 *
 * Handles three error categories:
 * 1. **Vercel AI SDK `APICallError`** — maps the upstream HTTP status and provider
 *    info to an OpenAI-style error envelope.
 * 2. **`FallbackTimeoutError`** — gateway-level timeout during provider fallback,
 *    returned as HTTP 504.
 * 3. **Generic errors** — catch-all that masks error details in production.
 *
 * Every error is recorded to the error tracker for per-provider health monitoring.
 *
 * Inspired by LiteLLM's error normalization strategy.
 */
export const errorHandler: ErrorHandler = (err, c) => {
	logger.error({
		type: "error",
		message: err.message,
		stack: err.stack,
		path: c.req.path,
	});

	// selectedProvider is set by smart-router middleware (see SmartRouterEnv).
	// It may be undefined if the error occurred before routing ran.
	const contextProvider = c.get("selectedProvider") as RankedProvider | undefined;
	const isTimeout = err instanceof FallbackTimeoutError;

	// Handle Vercel AI SDK API errors (from providers)
	if (err instanceof APICallError) {
		const status = err.statusCode ?? 500;
		const provider = resolveProvider(contextProvider, err);

		trackError(provider, status, err.message, isTimeout);

		const errorResponse: GatewayError = {
			error: {
				message: err.message,
				type: mapStatusToErrorType(status),
				code: status,
				provider: extractProviderFromError(err),
			},
		};
		return c.json(errorResponse, mapStatus(status));
	}

	// Determine status code for non-API errors
	const genericStatus = isTimeout ? 504 : (extractStatusCode(err) ?? 500);
	const provider = resolveProvider(contextProvider);

	trackError(provider, genericStatus, err.message, isTimeout);

	// Handle generic errors
	const errorResponse: GatewayError = {
		error: {
			message: env.NODE_ENV === "development" ? err.message : "Internal server error",
			type: "internal_error",
			code: "internal_error",
		},
	};

	return c.json(errorResponse, mapStatus(genericStatus));
};

/** Map HTTP status codes to OpenAI-style error types */
function mapStatusToErrorType(status: number): string {
	if (status === 401) return "authentication_error";
	if (status === 403) return "permission_error";
	if (status === 404) return "not_found_error";
	if (status === 429) return "rate_limit_error";
	if (status >= 400 && status < 500) return "invalid_request_error";
	return "api_error";
}

/** Ensure status is a valid HTTP status code */
function mapStatus(status: number): 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503 | 504 {
	const validStatuses = [400, 401, 403, 404, 429, 500, 502, 503, 504] as const;
	for (const valid of validStatuses) {
		if (status === valid) return valid;
	}
	if (status >= 400 && status < 500) return 400;
	return 500;
}

/** Try to extract a numeric status code from an error object. */
function extractStatusCode(err: Error): number | undefined {
	if ("statusCode" in err && typeof err.statusCode === "number") {
		return err.statusCode;
	}
	return undefined;
}

/**
 * Type guard that checks whether a string is a known {@link ProviderName}.
 */
function isProviderName(value: string): value is ProviderName {
	return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * Try to extract a typed provider name from an API error's URL.
 *
 * Returns a {@link ProviderName} when the URL matches a known provider domain,
 * or `undefined` if the provider cannot be determined.
 */
function extractProviderFromError(err: APICallError): ProviderName | undefined {
	const url = err.url;
	if (!url) return undefined;

	const mapping: Record<string, string> = {
		"openai.com": "openai",
		"anthropic.com": "anthropic",
		"googleapis.com": "google",
		generativelanguage: "google",
	};

	for (const [domain, provider] of Object.entries(mapping)) {
		if (url.includes(domain) && isProviderName(provider)) {
			return provider;
		}
	}

	return undefined;
}
