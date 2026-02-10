import { zValidator } from "@hono/zod-validator";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { generateText, streamText } from "ai";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "@/middleware/logging.ts";
import { recordCost } from "@/services/cost-tracker.ts";
import { routeModel } from "@/services/router/index.ts";
import { getTracer } from "@/telemetry/setup.ts";
import type { ChatCompletionChunk, ChatCompletionResponse } from "@/types/index.ts";
import { ChatCompletionRequestSchema } from "@/types/index.ts";

const chat = new Hono();

/** Maximum plausible token count — anything above this is likely a bug */
const MAX_REASONABLE_TOKENS = 1_000_000;

/**
 * Validate token counts before recording cost.
 * Returns true if tokens are within reasonable bounds.
 * Logs warnings for suspicious values and returns false for obviously bad data.
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

function generateId(): string {
	return `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

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

			// Capture OTel context before entering SSE callback to prevent context loss
			const otelCtx = context.active();

			return streamSSE(c, async (sseStream) => {
				await context.with(otelCtx, async () => {
					try {
						const result = streamText({
							model: route.model,
							messages: messages.map((m) => ({
								role: m.role,
								content: m.content,
							})),
							temperature,
							maxOutputTokens: max_tokens ?? undefined,
							topP: top_p ?? undefined,
							stopSequences,
							onError({ error }) {
								console.error("Stream error:", error);
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

							await sseStream.writeSSE({
								data: JSON.stringify(chunk),
							});
						}

						// Send final chunk with finish_reason
						const finalChunk: ChatCompletionChunk = {
							id: completionId,
							object: "chat.completion.chunk",
							created,
							model: route.modelId,
							choices: [
								{
									index: 0,
									delta: {},
									finish_reason: "stop",
								},
							],
						};

						await sseStream.writeSSE({
							data: JSON.stringify(finalChunk),
						});

						// Send [DONE] marker per OpenAI spec
						await sseStream.writeSSE({
							data: "[DONE]",
						});

						// Record cost after stream completes (Vercel AI SDK resolves usage after stream)
						try {
							const usage = await result.usage;
							if (usage) {
								const inputTokens = usage.inputTokens ?? 0;
								const outputTokens = usage.outputTokens ?? 0;

								if (!usage.inputTokens && !usage.outputTokens) {
									logger.warn(
										{ provider: route.provider, model: route.modelId, streaming: true },
										"Provider returned empty usage data — recording zero cost",
									);
								}

								if (validateTokenCounts(inputTokens, outputTokens, route.provider, route.modelId)) {
									const costRecord = recordCost(
										route.provider,
										route.modelId,
										inputTokens,
										outputTokens,
									);
									logger.info({
										type: "cost",
										provider: route.provider,
										model: route.modelId,
										streaming: true,
										input_tokens: inputTokens,
										output_tokens: outputTokens,
										cost_usd: costRecord.costUsd,
									});
								}

								llmSpan.setAttributes({
									"tokens.input": inputTokens,
									"tokens.output": outputTokens,
									latency_ms: Date.now() - llmStart,
								});
							} else {
								logger.warn(
									{ provider: route.provider, model: route.modelId, streaming: true },
									"Provider did not return usage data — cost not recorded",
								);
								llmSpan.setAttributes({ latency_ms: Date.now() - llmStart });
							}
						} catch {
							// Usage may not be available for all providers — non-fatal
							logger.warn(
								{ provider: route.provider, model: route.modelId, streaming: true },
								"Failed to resolve usage data from stream — cost not recorded",
							);
							llmSpan.setAttributes({ latency_ms: Date.now() - llmStart });
						}

						llmSpan.setStatus({ code: SpanStatusCode.OK });
					} catch (error) {
						llmSpan.setStatus({ code: SpanStatusCode.ERROR });
						if (error instanceof Error) {
							llmSpan.recordException(error);
						}
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
				messages: messages.map((m) => ({
					role: m.role,
					content: m.content,
				})),
				temperature,
				maxOutputTokens: max_tokens ?? undefined,
				topP: top_p ?? undefined,
				stopSequences,
			});

			const inputTokens = result.usage?.inputTokens ?? 0;
			const outputTokens = result.usage?.outputTokens ?? 0;

			if (!result.usage?.inputTokens && !result.usage?.outputTokens) {
				logger.warn(
					{ provider: route.provider, model: route.modelId, streaming: false },
					"Provider did not return usage data — recording zero cost",
				);
			}

			// Record cost tracking (skip obviously bad data)
			if (validateTokenCounts(inputTokens, outputTokens, route.provider, route.modelId)) {
				const costRecord = recordCost(route.provider, route.modelId, inputTokens, outputTokens);
				logger.info({
					type: "cost",
					provider: route.provider,
					model: route.modelId,
					streaming: false,
					input_tokens: inputTokens,
					output_tokens: outputTokens,
					cost_usd: costRecord.costUsd,
				});
			}

			const response: ChatCompletionResponse = {
				id: generateId(),
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: route.modelId,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: result.text,
						},
						finish_reason: result.finishReason ?? "stop",
					},
				],
				usage: {
					prompt_tokens: inputTokens,
					completion_tokens: outputTokens,
					total_tokens: result.usage?.totalTokens ?? 0,
				},
			};

			llmSpan.setAttributes({
				"tokens.input": inputTokens,
				"tokens.output": outputTokens,
				latency_ms: Date.now() - llmStart,
			});
			llmSpan.setStatus({ code: SpanStatusCode.OK });
			llmSpan.end();

			return c.json(response);
		} catch (error) {
			llmSpan.setStatus({ code: SpanStatusCode.ERROR });
			if (error instanceof Error) {
				llmSpan.recordException(error);
			}
			llmSpan.end();
			throw error;
		}
	},
);

export { chat };
