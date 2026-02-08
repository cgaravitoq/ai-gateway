import type { MiddlewareHandler } from "hono";
import { cacheConfig } from "@/config/cache.ts";
import { logger } from "@/middleware/logging.ts";
import { cacheResponse, semanticSearch } from "@/services/cache/semantic-cache.ts";
import type { ChatCompletionResponse } from "@/types/index.ts";

/**
 * Semantic cache middleware for the chat completions endpoint.
 *
 * On request: checks semantic cache for similar queries; returns cached response on hit.
 * On response: stores the response asynchronously (does not block the response).
 *
 * Respects:
 * - X-Skip-Cache header to bypass cache
 * - CACHE_ENABLED env var
 * - Only caches non-streaming responses
 */
export function semanticCacheMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		// Skip if cache is disabled
		if (!cacheConfig.enabled) {
			c.header("X-Cache", "DISABLED");
			await next();
			return;
		}

		// Skip if explicitly requested via header
		if (c.req.header("X-Skip-Cache") === "true") {
			c.header("X-Cache", "SKIP");
			await next();
			return;
		}

		// Only apply to POST /v1/chat/completions
		if (c.req.method !== "POST" || !c.req.path.endsWith("/v1/chat/completions")) {
			await next();
			return;
		}

		let body: {
			model: string;
			messages: Array<{ role: string; content: string }>;
			stream?: boolean;
		};

		try {
			body = await c.req.json();
		} catch {
			// Can't parse body — skip cache and let the route handler deal with it
			await next();
			return;
		}

		// Skip cache for streaming requests (we only cache non-streaming)
		if (body.stream) {
			c.header("X-Cache", "MISS");
			await next();
			return;
		}

		// --- Cache Lookup ---
		try {
			const cacheResult = await semanticSearch(body.messages, body.model);

			if (cacheResult.hit && cacheResult.response) {
				logger.info(
					{ model: body.model, score: cacheResult.score?.toFixed(4) },
					"Returning cached response",
				);

				const cachedResponse: ChatCompletionResponse = {
					id: `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: cacheResult.model ?? body.model,
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: cacheResult.response },
							finish_reason: "stop",
						},
					],
					usage: cacheResult.usage ?? {
						prompt_tokens: 0,
						completion_tokens: 0,
						total_tokens: 0,
					},
				};

				c.header("X-Cache", "HIT");
				c.header("X-Cache-Score", cacheResult.score?.toFixed(4) ?? "0");
				return c.json(cachedResponse);
			}
		} catch (err) {
			logger.error(
				{ err: err instanceof Error ? err.message : String(err) },
				"Cache lookup failed — proceeding without cache",
			);
		}

		// --- Cache Miss: proceed to LLM ---
		c.header("X-Cache", "MISS");
		await next();

		// --- Cache Store: save the response asynchronously ---
		try {
			// Only cache successful responses
			if (c.res.status === 200) {
				// Clone the response so we can read the body without consuming it
				const resClone = c.res.clone();
				const responseData = (await resClone.json()) as ChatCompletionResponse;

				const responseText = responseData.choices?.[0]?.message?.content;
				if (responseText) {
					// Fire and forget — don't block the response
					cacheResponse(body.messages, body.model, responseText, responseData.usage).catch(
						(err) => {
							logger.error(
								{ err: err instanceof Error ? err.message : String(err) },
								"Async cache store failed",
							);
						},
					);
				}
			}
		} catch (err) {
			logger.error({ err: err instanceof Error ? err.message : String(err) }, "Cache store failed");
		}
	};
}
