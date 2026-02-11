import type { MiddlewareHandler } from "hono";
import { env } from "@/config/env.ts";
import type { ProviderName } from "@/config/providers.ts";
import { detectProvider } from "@/services/providers/index.ts";
import type { GatewayError } from "@/types/index.ts";
import type { ProviderRateLimitConfig, RateLimitConfig } from "@/types/rate-limit.ts";
import { TokenBucket } from "@/utils/token-bucket.ts";
import { logger } from "./logging.ts";

// ---------------------------------------------------------------------------
// Configuration — read from validated environment
// ---------------------------------------------------------------------------

/** Build rate limit config from validated environment variables */
function loadRateLimitConfig(): RateLimitConfig {
	const providerConfig = (name: ProviderName): ProviderRateLimitConfig => {
		const upperName = name.toUpperCase() as "OPENAI" | "ANTHROPIC" | "GOOGLE";
		return {
			maxTokens:
				env[`RATE_LIMIT_${upperName}_MAX_TOKENS` as keyof typeof env] ?? env.RATE_LIMIT_MAX_TOKENS,
			refillRate:
				env[`RATE_LIMIT_${upperName}_REFILL_RATE` as keyof typeof env] ??
				env.RATE_LIMIT_REFILL_RATE,
		} as ProviderRateLimitConfig;
	};

	return {
		enabled: env.RATE_LIMIT_ENABLED,
		providers: {
			openai: providerConfig("openai"),
			anthropic: providerConfig("anthropic"),
			google: providerConfig("google"),
		},
	};
}

// ---------------------------------------------------------------------------
// Bucket registry — one bucket per provider, lazily created
// ---------------------------------------------------------------------------

const config = loadRateLimitConfig();
const buckets = new Map<ProviderName, TokenBucket>();

function getBucket(provider: ProviderName): TokenBucket {
	let bucket = buckets.get(provider);
	if (!bucket) {
		const cfg = config.providers[provider];
		bucket = new TokenBucket(cfg.maxTokens, cfg.refillRate);
		buckets.set(provider, bucket);
		logger.info(
			{ provider, maxTokens: cfg.maxTokens, refillRate: cfg.refillRate },
			"Rate limit bucket created",
		);
	}
	return bucket;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Per-provider token bucket rate limiter.
 *
 * Extracts the `model` field from the request body, detects the target
 * provider, and checks the provider's token bucket before forwarding.
 *
 * Returns 429 with standard OpenAI-compatible error body + `Retry-After`
 * header when the bucket is empty.
 */
export function rateLimiter(): MiddlewareHandler {
	return async (c, next) => {
		// Rate limiting disabled — pass through
		if (!config.enabled) {
			await next();
			return;
		}

		// Only rate-limit POST requests (chat completions)
		if (c.req.method !== "POST") {
			await next();
			return;
		}

		// --- Parse model from request body ---
		// NOTE: Hono's `c.req.json()` caches the parsed result internally, so
		// multiple middleware (rate-limiter, cache, etc.) calling it is safe and
		// does not consume the body stream more than once.
		let model: string | undefined;
		try {
			const body = await c.req.json();
			model = body.model;
		} catch {
			const errorResponse: GatewayError = {
				error: {
					message: "Invalid request body: expected valid JSON",
					type: "invalid_request_error",
					code: "invalid_body",
				},
			};
			return c.json(errorResponse, 400);
		}

		if (!model) {
			const errorResponse: GatewayError = {
				error: {
					message: "model field is required",
					type: "invalid_request_error",
					code: "missing_model",
				},
			};
			return c.json(errorResponse, 400);
		}

		// --- Detect provider from model ID ---
		const provider = detectProvider(model);
		if (!provider) {
			const errorResponse: GatewayError = {
				error: {
					message: `Unknown model provider for model '${model}'`,
					type: "invalid_request_error",
					code: "unknown_provider",
				},
			};
			return c.json(errorResponse, 400);
		}

		// --- Token bucket check ---
		const bucket = getBucket(provider);

		if (!bucket.tryAcquire()) {
			const retryAfter = bucket.getRetryAfter();

			logger.warn({ provider, model, retryAfter }, "Rate limit exceeded");

			c.header("Retry-After", String(retryAfter));
			c.header("X-RateLimit-Limit", String(config.providers[provider].maxTokens));
			c.header("X-RateLimit-Remaining", "0");

			const errorResponse: GatewayError = {
				error: {
					message: `Rate limit exceeded for provider '${provider}'. Retry after ${retryAfter}s.`,
					type: "rate_limit_error",
					code: "rate_limit_exceeded",
					provider,
				},
			};

			return c.json(errorResponse, 429);
		}

		// --- Allowed — attach rate limit info headers ---
		c.header("X-RateLimit-Limit", String(config.providers[provider].maxTokens));
		c.header("X-RateLimit-Remaining", String(bucket.getRemaining()));

		await next();
	};
}
