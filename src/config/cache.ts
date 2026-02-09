import { env } from "@/config/env.ts";

/**
 * Cache configuration — derived from validated environment variables.
 * Controls Redis connection, TTL, similarity threshold, and embedding model.
 */
export const cacheConfig = {
	/** Whether semantic caching is enabled */
	enabled: env.CACHE_ENABLED,

	/** Redis connection URL */
	redisUrl: env.REDIS_URL,

	/** Cache TTL in seconds (default: 1 hour) */
	ttlSeconds: env.CACHE_TTL_SECONDS,

	/**
	 * Cosine distance threshold for cache hits.
	 * Lower = stricter matching. Redis uses cosine DISTANCE (0 = identical, 1 = opposite).
	 * Default 0.15 ≈ 0.85 similarity.
	 */
	similarityThreshold: env.CACHE_SIMILARITY_THRESHOLD,

	/** OpenAI embedding model */
	embeddingModel: env.EMBEDDING_MODEL,

	/** Embedding dimensions (must match the model) */
	embeddingDimensions: env.EMBEDDING_DIMENSIONS,

	/** Redis index name for vector search */
	indexName: "idx:semantic-cache",

	/** Redis key prefix for cached entries */
	keyPrefix: "cache:",
} as const;
