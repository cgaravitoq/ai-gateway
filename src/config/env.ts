import { z } from "zod/v4";

/**
 * Centralized environment variables — validated with Zod at startup.
 * Single source of truth for all env vars used in the gateway.
 *
 * If a required variable is missing, the process will fail fast
 * with a clear error message listing all invalid/missing values.
 */
const envSchema = z.object({
	// ── Server ──────────────────────────────────────────────────
	PORT: z.coerce.number().default(3000),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

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
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
	const result = envSchema.safeParse(process.env);

	if (!result.success) {
		console.error("Invalid environment variables:");
		console.error(JSON.stringify(result.error.format(), null, 2));
		process.exit(1);
	}

	return result.data;
}

/** Validated environment variables — import this instead of using process.env */
export const env = loadEnv();
