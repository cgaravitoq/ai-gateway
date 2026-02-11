import { cacheConfig } from "@/config/cache.ts";
import { logger } from "@/middleware/logging.ts";
import { generateEmbedding, normalizeMessages } from "./embeddings.ts";
import { getRedisClient } from "./redis.ts";

/** Shape of a cached response stored in Redis as a JSON document. */
export interface CachedResponse {
	query: string;
	model: string;
	response: string;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	embedding: number[];
	createdAt: number;
}

/** Result of a semantic cache lookup (hit + optional response data). */
export interface CacheSearchResult {
	hit: boolean;
	response?: string;
	usage?: CachedResponse["usage"];
	model?: string;
	score?: number;
}

/** Shape of the ft.search result (RESP2 protocol) */
interface SearchResult {
	total: number;
	documents: Array<{
		id: string;
		value: Record<string, string | number | null>;
	}>;
}

/**
 * Convert a number array to a Float32Array Buffer for Redis vector queries.
 * Redis expects BLOB as a raw Float32Array buffer.
 */
function float32Buffer(arr: number[]): Buffer {
	return Buffer.from(new Float32Array(arr).buffer);
}

/**
 * Search the semantic cache for a similar query.
 * Uses KNN vector search with cosine distance.
 *
 * @param messages - The chat messages to search for
 * @param model - The model identifier (cache is model-scoped)
 * @returns Cache hit result with response if found
 */
export async function semanticSearch(
	messages: Array<{ role: string; content: string }>,
	model: string,
): Promise<CacheSearchResult> {
	// Validate model name to prevent Redis injection
	if (!validateModelName(model)) {
		logger.warn({ model }, "Invalid model name in semantic search");
		return { hit: false };
	}

	const client = getRedisClient();

	if (!client.isOpen) {
		return { hit: false };
	}

	try {
		const queryText = normalizeMessages(messages);
		const embedding = await generateEmbedding(queryText);

		// KNN search scoped to the same model using a TAG filter
		const results = (await client.ft.search(
			cacheConfig.indexName,
			`@model:{${escapeTag(model)}}=>[KNN 1 @vector $BLOB AS score]`,
			{
				PARAMS: { BLOB: float32Buffer(embedding) },
				RETURN: ["score", "$.response", "$.usage", "$.model"],
				DIALECT: 2,
			},
		)) as unknown as SearchResult;

		if (results.total > 0 && results.documents.length > 0) {
			const doc = results.documents[0];
			if (!doc) return { hit: false };

			const score = Number(doc.value.score);

			// Cosine DISTANCE: lower = more similar (0 = identical)
			if (score < cacheConfig.similarityThreshold) {
				const response = doc.value["$.response"] as string;
				const usageRaw = doc.value["$.usage"];
				const usage = typeof usageRaw === "string" ? JSON.parse(usageRaw) : usageRaw;

				logger.info({ score: score.toFixed(4), model }, "Semantic cache HIT");

				return {
					hit: true,
					response,
					usage: usage as CachedResponse["usage"],
					model: doc.value["$.model"] as string,
					score,
				};
			}

			logger.debug(
				{ score: score.toFixed(4), threshold: cacheConfig.similarityThreshold },
				"Cache miss — above similarity threshold",
			);
		}

		return { hit: false };
	} catch (err) {
		logger.error(
			{ err: err instanceof Error ? err.message : String(err) },
			"Semantic cache search failed",
		);
		return { hit: false };
	}
}

/**
 * Store a response in the semantic cache.
 *
 * @param messages - The original chat messages
 * @param model - The model identifier
 * @param response - The LLM response text
 * @param usage - Token usage stats
 */
export async function cacheResponse(
	messages: Array<{ role: string; content: string }>,
	model: string,
	response: string,
	usage: CachedResponse["usage"],
): Promise<void> {
	// Validate model name to prevent Redis injection
	if (!validateModelName(model)) {
		logger.warn({ model }, "Invalid model name in cache response");
		return;
	}

	const client = getRedisClient();

	if (!client.isOpen) return;

	try {
		const queryText = normalizeMessages(messages);
		const embedding = await generateEmbedding(queryText);

		const key = `${cacheConfig.keyPrefix}${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

		const cacheEntry: CachedResponse = {
			query: queryText,
			model,
			response,
			usage,
			embedding,
			createdAt: Date.now(),
		};

		// biome-ignore lint/suspicious/noExplicitAny: Redis JSON type is overly restrictive for nested objects
		await client.json.set(key, "$", cacheEntry as any);
		await client.expire(key, cacheConfig.ttlSeconds);

		logger.debug({ key, model }, "Response cached");
	} catch (err) {
		logger.error(
			{ err: err instanceof Error ? err.message : String(err) },
			"Failed to cache response",
		);
	}
}

/**
 * Validate model name against allowed pattern.
 * Prevents injection by rejecting invalid model names before escaping.
 */
function validateModelName(model: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model);
}

/**
 * Escape special characters in a Redis TAG value.
 * Escapes ALL Redis query special chars: {}|@*()!~\"' plus spaces and dots/colons/slashes/dashes.
 */
function escapeTag(value: string): string {
	return value.replace(/[{}|@*()!~\\"'.:\-/\s]/g, "\\$&");
}
