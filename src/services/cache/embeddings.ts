import OpenAI from "openai";
import { cacheConfig } from "@/config/cache.ts";
import { env } from "@/config/env.ts";
import { logger } from "@/middleware/logging.ts";

const EMBEDDING_TIMEOUT_MS = 10_000;

let openaiClient: OpenAI | null = null;

/**
 * Get or create the OpenAI client for embedding generation.
 * Uses OPENAI_API_KEY from validated environment.
 */
function getOpenAIClient(): OpenAI {
	if (openaiClient) return openaiClient;

	openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
	return openaiClient;
}

/**
 * Generate an embedding vector for the given text using OpenAI's embedding API.
 *
 * @param text - The input text to embed (typically the user's query/messages)
 * @returns Float array of embedding dimensions
 */
export async function generateEmbedding(text: string): Promise<number[]> {
	const client = getOpenAIClient();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

	try {
		const start = Date.now();

		const response = await client.embeddings.create(
			{
				model: cacheConfig.embeddingModel,
				input: text,
				dimensions: cacheConfig.embeddingDimensions,
			},
			{ signal: controller.signal },
		);

		const duration = Date.now() - start;
		logger.debug({ model: cacheConfig.embeddingModel, duration }, "Embedding generated");

		const embedding = response.data[0]?.embedding;
		if (!embedding) {
			throw new Error("No embedding returned from OpenAI API");
		}

		return embedding;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			logger.warn({ timeoutMs: EMBEDDING_TIMEOUT_MS }, "Embedding generation timed out");
			throw new Error("Embedding generation timed out");
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Normalize chat messages into a single string suitable for embedding.
 * Concatenates role + content for each message.
 */
export function normalizeMessages(messages: Array<{ role: string; content: string }>): string {
	return messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}
