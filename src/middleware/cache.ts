import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";
import { cacheConfig } from "@/config/cache.ts";
import { logger } from "@/middleware/logging.ts";
import { cacheResponse, semanticSearch } from "@/services/cache/semantic-cache.ts";
import {
	recordCacheError,
	recordCacheHit,
	recordCacheMiss,
	recordCacheSkip,
	recordRequest,
} from "@/services/metrics.ts";
import { getTracer } from "@/telemetry/setup.ts";
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
		recordRequest();

		// Skip if cache is disabled
		if (!cacheConfig.enabled) {
			c.header("X-Cache", "DISABLED");
			recordCacheSkip();
			await next();
			return;
		}

		// Skip if explicitly requested via header
		if (c.req.header("X-Skip-Cache") === "true") {
			c.header("X-Cache", "SKIP");
			recordCacheSkip();
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
			// NOTE: Hono's `c.req.json()` caches the parsed result internally, so
			// multiple middleware (rate-limiter, cache, etc.) calling it is safe and
			// does not consume the body stream more than once.
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

		// --- Cache Lookup (with tracing) ---
		const cacheStart = Date.now();

		// Create a child span for cache operations (graceful no-op if tracing is off)
		const parentSpan = trace.getSpan(context.active());
		const tracer = getTracer();
		const cacheSpan = tracer.startSpan(
			"gateway.cache",
			{
				attributes: { "cache.hit": false },
			},
			parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined,
		);

		try {
			const cacheResult = await semanticSearch(body.messages, body.model);
			const cacheLatencyMs = Date.now() - cacheStart;

			if (cacheResult.hit && cacheResult.response) {
				recordCacheHit(cacheLatencyMs);
				logger.info(
					{ model: body.model, score: cacheResult.score?.toFixed(4) },
					"Returning cached response",
				);

				cacheSpan.setAttributes({
					"cache.hit": true,
					"cache.similarity": cacheResult.score ?? 0,
					"cache.latency_ms": cacheLatencyMs,
				});
				cacheSpan.setStatus({ code: SpanStatusCode.OK });
				cacheSpan.end();

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
			recordCacheError();
			logger.error(
				{ err: err instanceof Error ? err.message : String(err) },
				"Cache lookup failed — proceeding without cache",
			);
			cacheSpan.setStatus({ code: SpanStatusCode.ERROR });
			if (err instanceof Error) {
				cacheSpan.recordException(err);
			}
		}

		// --- Cache Miss: proceed to LLM ---
		const missLatencyMs = Date.now() - cacheStart;
		recordCacheMiss(missLatencyMs);
		cacheSpan.setAttributes({
			"cache.hit": false,
			"cache.latency_ms": missLatencyMs,
		});
		cacheSpan.setStatus({ code: SpanStatusCode.OK });
		cacheSpan.end();
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
