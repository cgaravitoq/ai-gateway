import { z } from "zod/v4";

/**
 * Centralized environment variables — validated with Zod at startup.
 * Single source of truth for all env vars used in the gateway.
 *
 * If a required variable is missing, the process will fail fast
 * with a clear error message listing all invalid/missing values.
 *
 * ──────────────────────────────────────────────────────────────────
 * TIMEOUT HIERARCHY
 * ──────────────────────────────────────────────────────────────────
 * ROUTING_TIMEOUT_MS is the *global* request timeout — the outer
 * boundary that AbortController enforces on any single request.
 *
 * TIMEOUT_{PROVIDER}_MS are *per-provider* timeouts used by the
 * timeout middleware to give each provider its own deadline.
 *
 * Invariant: ROUTING_TIMEOUT_MS >= max(all provider timeouts)
 *
 * If violated, the global timeout fires first and silently kills
 * the request before the per-provider timeout can trigger retries
 * or fallback logic.  The .superRefine() at the bottom enforces
 * this at startup so the gateway fails fast instead of silently
 * dropping requests at runtime.
 * ──────────────────────────────────────────────────────────────────
 */
export const envSchema = z
	.object({
		// ── Server ──────────────────────────────────────────────────
		PORT: z.coerce.number().default(3000),
		NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
		LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

		// ── Gateway Authentication ─────────────────────────────────
		/** Required — API key for authenticating requests to the gateway */
		GATEWAY_API_KEY: z.string().min(1, "GATEWAY_API_KEY is required"),

		// ── LLM Provider API Keys ──────────────────────────────────
		/** Required — used for chat completions and embedding generation */
		OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
		/** Optional — enables Anthropic (Claude) models */
		ANTHROPIC_API_KEY: z.string().optional(),
		/** Optional — enables Google (Gemini) models */
		GOOGLE_API_KEY: z.string().optional(),

		// ── Redis / Cache ──────────────────────────────────────────
		REDIS_URL: z.string().default("redis://localhost:6379"),
		CACHE_ENABLED: z
			.string()
			.default("true")
			.transform((v) => v !== "false"),
		CACHE_TTL_SECONDS: z.coerce.number().positive().default(3600),
		/**
		 * Cosine distance threshold for cache hits.
		 * Lower = stricter matching (0 = identical, 1 = opposite).
		 * Default 0.15 ≈ 0.85 similarity.
		 */
		CACHE_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.15),

		// ── Embedding Model ────────────────────────────────────────
		EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
		EMBEDDING_DIMENSIONS: z.coerce.number().positive().default(1536),

		// ── Routing ────────────────────────────────────────────────
		ROUTING_STRATEGY: z.enum(["cost", "latency", "balanced", "capability"]).default("balanced"),
		/**
		 * Global request timeout — the outer boundary for any single request.
		 * Must be >= every per-provider timeout (TIMEOUT_*_MS) so that
		 * provider-specific timeouts fire first and trigger retries/fallbacks
		 * instead of the global timeout silently killing the request.
		 *
		 * Default 60 000 ms matches the highest provider timeout (Anthropic).
		 */
		ROUTING_TIMEOUT_MS: z.coerce.number().positive().default(60_000),
		ROUTING_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
		ROUTING_RETRY_BACKOFF_MS: z.coerce.number().positive().default(500),
		ROUTING_LATENCY_ALPHA: z.coerce.number().min(0).max(1).default(0.3),
		ROUTING_LATENCY_WINDOW: z.coerce.number().int().positive().default(100),

		// ── Rate Limiting (token bucket) ───────────────────────────
		RATE_LIMIT_ENABLED: z
			.string()
			.default("true")
			.transform((v) => v !== "false"),
		RATE_LIMIT_MAX_TOKENS: z.coerce.number().positive().default(60),
		RATE_LIMIT_REFILL_RATE: z.coerce.number().positive().default(1),
		/** Per-provider overrides (optional) */
		RATE_LIMIT_OPENAI_MAX_TOKENS: z.coerce.number().positive().optional(),
		RATE_LIMIT_OPENAI_REFILL_RATE: z.coerce.number().positive().optional(),
		RATE_LIMIT_ANTHROPIC_MAX_TOKENS: z.coerce.number().positive().optional(),
		RATE_LIMIT_ANTHROPIC_REFILL_RATE: z.coerce.number().positive().optional(),
		RATE_LIMIT_GOOGLE_MAX_TOKENS: z.coerce.number().positive().optional(),
		RATE_LIMIT_GOOGLE_REFILL_RATE: z.coerce.number().positive().optional(),

		// ── Timeouts (ms) — per-provider LLM request timeouts ─────
		// These must always be <= ROUTING_TIMEOUT_MS (see .superRefine() below).
		TIMEOUT_OPENAI_MS: z.coerce.number().positive().default(30_000),
		TIMEOUT_ANTHROPIC_MS: z.coerce.number().positive().default(60_000),
		TIMEOUT_GOOGLE_MS: z.coerce.number().positive().default(30_000),
	})
	.superRefine((env, ctx) => {
		const maxProviderTimeout = Math.max(
			env.TIMEOUT_OPENAI_MS,
			env.TIMEOUT_ANTHROPIC_MS,
			env.TIMEOUT_GOOGLE_MS,
		);
		if (env.ROUTING_TIMEOUT_MS < maxProviderTimeout) {
			ctx.addIssue({
				code: "custom",
				path: ["ROUTING_TIMEOUT_MS"],
				message:
					`ROUTING_TIMEOUT_MS (${env.ROUTING_TIMEOUT_MS}ms) must be >= the highest ` +
					`per-provider timeout (${maxProviderTimeout}ms). Otherwise the global ` +
					`timeout silently kills requests before the provider timeout can fire.`,
			});
		}
	});
