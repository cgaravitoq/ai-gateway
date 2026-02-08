import { zValidator } from "@hono/zod-validator";
import { generateText, streamText } from "ai";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { routeModel } from "@/services/router/index.ts";
import type { ChatCompletionChunk, ChatCompletionResponse } from "@/types/index.ts";
import { ChatCompletionRequestSchema } from "@/types/index.ts";

const chat = new Hono();

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

		if (stream) {
			// --- Streaming Response (SSE) ---
			const completionId = generateId();
			const created = Math.floor(Date.now() / 1000);

			return streamSSE(c, async (sseStream) => {
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
			});
		}

		// --- Non-streaming Response ---
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
				prompt_tokens: result.usage?.inputTokens ?? 0,
				completion_tokens: result.usage?.outputTokens ?? 0,
				total_tokens: result.usage?.totalTokens ?? 0,
			},
		};

		return c.json(response);
	},
);

export { chat };
