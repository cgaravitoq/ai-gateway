import { APICallError } from "ai";
import type { ErrorHandler } from "hono";
import type { GatewayError } from "@/types/index.ts";
import { logger } from "./logging.ts";

/**
 * Global error handler that normalizes all errors to OpenAI-compatible format.
 * Inspired by LiteLLM's error normalization strategy.
 */
export const errorHandler: ErrorHandler = (err, c) => {
	logger.error({
		type: "error",
		message: err.message,
		stack: err.stack,
		path: c.req.path,
	});

	// Handle Vercel AI SDK API errors (from providers)
	if (err instanceof APICallError) {
		const status = err.statusCode ?? 500;
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

	// Handle generic errors
	const errorResponse: GatewayError = {
		error: {
			message: process.env.NODE_ENV === "development" ? err.message : "Internal server error",
			type: "internal_error",
			code: "internal_error",
		},
	};

	return c.json(errorResponse, 500);
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
function mapStatus(status: number): 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503 {
	const validStatuses = [400, 401, 403, 404, 429, 500, 502, 503] as const;
	for (const valid of validStatuses) {
		if (status === valid) return valid;
	}
	if (status >= 400 && status < 500) return 400;
	return 500;
}

/** Try to extract provider name from API error */
function extractProviderFromError(err: APICallError): string | undefined {
	const url = err.url;
	if (!url) return undefined;
	if (url.includes("openai.com")) return "openai";
	if (url.includes("anthropic.com")) return "anthropic";
	if (url.includes("googleapis.com") || url.includes("generativelanguage")) return "google";
	return undefined;
}
