import { zValidator } from "@hono/zod-validator";
import type { Span } from "@opentelemetry/api";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { generateText, streamText } from "ai";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { env } from "@/config/env.ts";
import { logger } from "@/middleware/logging.ts";
import { recordCost } from "@/services/cost-tracker.ts";
import { type ResolvedRoute, routeModel } from "@/services/router/index.ts";
import { getTracer, recordSpanError } from "@/telemetry/setup.ts";
import type { ChatCompletionChunk, ChatCompletionResponse, Message } from "@/types/index.ts";
import { ChatCompletionRequestSchema } from "@/types/index.ts";

const chat = new Hono();

// ── Constants ────────────────────────────────────────────────

/** Maximum plausible token count — anything above this is likely a bug */
const MAX_REASONABLE_TOKENS = 1_000_000;

/** Prefix for generated completion IDs (matches OpenAI format) */
const COMPLETION_ID_PREFIX = "chatcmpl-";

/** Length of the random suffix in completion IDs */
const COMPLETION_ID_SUFFIX_LENGTH = 24;

// ── Shared Helpers ───────────────────────────────────────────

/**
 * Validate token counts before recording cost.
 * @returns `true` if tokens are within reasonable bounds.
 */
function validateTokenCounts(
	inputTokens: number,
	outputTokens: number,
	provider: string,
	modelId: string,
): boolean {
	if (inputTokens < 0 || outputTokens < 0) {
		logger.warn(
			{ provider, model: modelId, inputTokens, outputTokens },
			"Negative token count from provider — skipping cost recording",
		);
		return false;
	}

	if (inputTokens > MAX_REASONABLE_TOKENS || outputTokens > MAX_REASONABLE_TOKENS) {
		logger.warn(
			{ provider, model: modelId, inputTokens, outputTokens },
			"Extreme token count (>1M) — skipping cost recording",
		);
		return false;
	}

	return true;
}

/** Generate an OpenAI-compatible completion ID. */
function generateId(): string {
	return `${COMPLETION_ID_PREFIX}${crypto.randomUUID().replace(/-/g, "").slice(0, COMPLETION_ID_SUFFIX_LENGTH)}`;
}

/**
 * Convert gateway message format to Vercel AI SDK message format.
 *
 * Maps the gateway's `Message` type (which uses the OpenAI-compatible schema)
 * to the `{ role, content }` tuples expected by the Vercel AI SDK's
 * `generateText` / `streamText` functions.
 */
function toSdkMessages(
	messages: Message[],
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
	return messages.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Record token usage, cost, and span attributes for a completed LLM call.
 *
 * Shared by both streaming and non-streaming paths. Validates token counts
 * before delegating to `recordCost()`, then annotates the active OTel span
 * with input/output tokens and latency.
 *
 * @param inputTokens  - Number of input (prompt) tokens consumed.
 * @param outputTokens - Number of output (completion) tokens generated.
 * @param route        - The resolved route containing provider and model info.
 * @param streaming    - Whether the response was streamed.
 * @param span         - The active OpenTelemetry span to annotate.
 * @param llmStart     - Timestamp (ms) when the LLM call started.
 */
function recordUsageAndCost(
	inputTokens: number,
	outputTokens: number,
	route: ResolvedRoute,
	streaming: boolean,
	span: Span,
	llmStart: number,
): void {
	if (!inputTokens && !outputTokens) {
		logger.warn(
			{ provider: route.provider, model: route.modelId, streaming },
			"Provider returned empty usage data — recording zero cost",
		);
	}

	if (validateTokenCounts(inputTokens, outputTokens, route.provider, route.modelId)) {
		const costRecord = recordCost(route.provider, route.modelId, inputTokens, outputTokens);
		logger.info({
			type: "cost",
			provider: route.provider,
			model: route.modelId,
			streaming,
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			cost_usd: costRecord.costUsd,
		});
	}

	span.setAttributes({
		"tokens.input": inputTokens,
		"tokens.output": outputTokens,
		latency_ms: Date.now() - llmStart,
	});
}

// ── Route Handler ────────────────────────────────────────────

chat.post(
	"/v1/chat/completions",
	zValidator("json", ChatCompletionRequestSchema, (result, c) => {
		if (!result.success) {
			return c.json(
				{
					error: {
						message: "Invalid request body",
						type: "invalid_request_error",
						code: "validation_error",
						details: result.error.issues,
					},
				},
				400,
			);
		}
	}),
	async (c) => {
		const body = c.req.valid("json");
		const { model, messages, stream, temperature, max_tokens, top_p, stop } = body;

		// Route to the correct provider
		const route = routeModel(model);

		// Convert stop to array format if needed
		const stopSequences = stop ? (Array.isArray(stop) ? stop : [stop]) : undefined;

		// Shared SDK message format
		const sdkMessages = toSdkMessages(messages);

		// Create LLM call span (child of the active trace context)
		const parentSpan = trace.getSpan(context.active());
		const tracer = getTracer();
		const llmSpan = tracer.startSpan(
			"gateway.llm_call",
			{
				attributes: {
					provider: route.provider,
					model: route.modelId,
					stream: stream ?? false,
				},
			},
			parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined,
		);

		const llmStart = Date.now();

		if (stream) {
			// --- Streaming Response (SSE) ---
			const completionId = generateId();
			const created = Math.floor(Date.now() / 1000);

			// Abort the stream if the provider stalls beyond the configured timeout.
			const streamTimeoutMs = env.ROUTING_TIMEOUT_MS ?? 30_000;
			const abortController = new AbortController();
			const streamTimer = setTimeout(() => abortController.abort(), streamTimeoutMs);

			// Capture the active OTel context before entering the SSE callback,
			// which may run outside the original async context.
			const capturedCtx = context.active();

			return streamSSE(c, async (sseStream) => {
				await context.with(capturedCtx, async () => {
					try {
						const result = streamText({
							model: route.model,
							messages: sdkMessages,
							temperature,
							maxOutputTokens: max_tokens ?? undefined,
							topP: top_p ?? undefined,
							stopSequences,
							abortSignal: abortController.signal,
							onError({ error }) {
								logger.error(
									{ err: error instanceof Error ? error.message : String(error) },
									"Stream error",
								);
							},
						});

						// Stream text deltas as OpenAI-compatible SSE chunks
						for await (const textPart of result.textStream) {
							const chunk: ChatCompletionChunk = {
								id: completionId,
								object: "chat.completion.chunk",
								created,
								model: route.modelId,
								choices: [
									{
										index: 0,
										delta: { content: textPart },
										finish_reason: null,
									},
								],
							};

							await sseStream.writeSSE({ data: JSON.stringify(chunk) });
						}

						// Send final chunk with finish_reason
						const finalChunk: ChatCompletionChunk = {
							id: completionId,
							object: "chat.completion.chunk",
							created,
							model: route.modelId,
							choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
						};

						await sseStream.writeSSE({ data: JSON.stringify(finalChunk) });
						await sseStream.writeSSE({ data: "[DONE]" });

						// Stream completed — cancel the timeout guard
						clearTimeout(streamTimer);

						// Record cost after stream completes
						try {
							const usage = await result.usage;
							if (usage) {
								recordUsageAndCost(
									usage.inputTokens ?? 0,
									usage.outputTokens ?? 0,
									route,
									true,
									llmSpan,
									llmStart,
								);
							} else {
								logger.warn(
									{ provider: route.provider, model: route.modelId, streaming: true },
									"Provider did not return usage data — cost not recorded",
								);
								llmSpan.setAttributes({ latency_ms: Date.now() - llmStart });
							}
						} catch (usageError) {
							logger.warn(
								{
									provider: route.provider,
									model: route.modelId,
									streaming: true,
									err: usageError instanceof Error ? usageError.message : String(usageError),
								},
								"Failed to resolve usage data from stream — cost not recorded",
							);
							llmSpan.setAttributes({ latency_ms: Date.now() - llmStart });
						}

						llmSpan.setStatus({ code: SpanStatusCode.OK });
					} catch (error) {
						clearTimeout(streamTimer);
						recordSpanError(llmSpan, error);
						throw error;
					} finally {
						llmSpan.end();
					}
				});
			});
		}

		// --- Non-streaming Response ---
		try {
			const result = await generateText({
				model: route.model,
				messages: sdkMessages,
				temperature,
				maxOutputTokens: max_tokens ?? undefined,
				topP: top_p ?? undefined,
				stopSequences,
			});

			const inputTokens = result.usage?.inputTokens ?? 0;
			const outputTokens = result.usage?.outputTokens ?? 0;

			recordUsageAndCost(inputTokens, outputTokens, route, false, llmSpan, llmStart);

			const response: ChatCompletionResponse = {
				id: generateId(),
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: route.modelId,
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: result.text },
						finish_reason: result.finishReason ?? "stop",
					},
				],
				usage: {
					prompt_tokens: inputTokens,
					completion_tokens: outputTokens,
					total_tokens: result.usage?.totalTokens ?? 0,
				},
			};

			llmSpan.setStatus({ code: SpanStatusCode.OK });
			llmSpan.end();

			return c.json(response);
		} catch (error) {
			recordSpanError(llmSpan, error);
			llmSpan.end();
			throw error;
		}
	},
);

export { chat };
