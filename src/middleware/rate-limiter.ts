import type { MiddlewareHandler } from "hono";
import type { ProviderName } from "@/config/providers.ts";
import { detectProvider } from "@/services/providers/index.ts";
import type { GatewayError } from "@/types/index.ts";
import type { ProviderRateLimitConfig, RateLimitConfig } from "@/types/rate-limit.ts";
import { TokenBucket } from "@/utils/token-bucket.ts";
import { logger } from "./logging.ts";

// ---------------------------------------------------------------------------
// Configuration — read from environment variables
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 60; // requests
const DEFAULT_REFILL_RATE = 1; // token per second (≈60 rpm)

function parseEnvInt(key: string, fallback: number): number {
	const raw = process.env[key];
	if (raw === undefined) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isNaN(parsed) ? fallback : parsed;
}

function parseEnvFloat(key: string, fallback: number): number {
	const raw = process.env[key];
	if (raw === undefined) return fallback;
	const parsed = Number.parseFloat(raw);
	return Number.isNaN(parsed) ? fallback : parsed;
}

/** Build rate limit config from environment variables */
function loadRateLimitConfig(): RateLimitConfig {
	const enabled = process.env.RATE_LIMIT_ENABLED !== "false"; // enabled by default

	const globalMax = parseEnvInt("RATE_LIMIT_MAX_TOKENS", DEFAULT_MAX_TOKENS);
	const globalRefill = parseEnvFloat("RATE_LIMIT_REFILL_RATE", DEFAULT_REFILL_RATE);

	const providerConfig = (name: ProviderName): ProviderRateLimitConfig => ({
		maxTokens: parseEnvInt(`RATE_LIMIT_${name.toUpperCase()}_MAX_TOKENS`, globalMax),
		refillRate: parseEnvFloat(`RATE_LIMIT_${name.toUpperCase()}_REFILL_RATE`, globalRefill),
	});

	return {
		enabled,
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
		let model: string | undefined;
		try {
			const body = await c.req.json();
			model = body.model;
		} catch {
			// Malformed body — let downstream route handler deal with it
			await next();
			return;
		}

		if (!model) {
			await next();
			return;
		}

		// --- Detect provider from model ID ---
		const provider = detectProvider(model);
		if (!provider) {
			// Unknown provider — skip rate limiting, let routing handle the error
			await next();
			return;
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
