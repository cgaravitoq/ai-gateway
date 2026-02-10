import { describe, expect, test } from "bun:test";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod/v4";

/**
 * Chat completions request validation tests.
 *
 * Tests the Zod validation layer without calling real LLM APIs.
 * Mirrors the validation logic from src/routes/chat.ts.
 */

const MessageSchema = z.object({
	role: z.enum(["system", "user", "assistant"]),
	content: z.string(),
});

const ChatCompletionRequestSchema = z.object({
	model: z.string(),
	messages: z.array(MessageSchema).min(1),
	temperature: z.number().min(0).max(2).optional(),
	max_tokens: z.number().int().positive().optional(),
	top_p: z.number().min(0).max(1).optional(),
	stream: z.boolean().optional().default(false),
	stop: z.union([z.string(), z.array(z.string())]).optional(),
});

function createValidationApp() {
	const app = new Hono();

	app.post(
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
			// Return a mock response instead of calling an LLM
			return c.json({
				id: "chatcmpl-test",
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: body.model,
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Mock response" },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			});
		},
	);

	return app;
}

function postChat(app: Hono, body: unknown) {
	return app.request("/v1/chat/completions", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("POST /v1/chat/completions — validation", () => {
	const app = createValidationApp();

	test("accepts a valid request", async () => {
		const res = await postChat(app, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "Hello!" }],
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.model).toBe("gpt-4o");
		expect(body.choices).toHaveLength(1);
	});

	test("rejects request without model", async () => {
		const res = await postChat(app, {
			messages: [{ role: "user", content: "Hello!" }],
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("validation_error");
	});

	test("rejects request without messages", async () => {
		const res = await postChat(app, {
			model: "gpt-4o",
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("validation_error");
	});

	test("rejects request with empty messages array", async () => {
		const res = await postChat(app, {
			model: "gpt-4o",
			messages: [],
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("validation_error");
	});

	test("rejects invalid message role", async () => {
		const res = await postChat(app, {
			model: "gpt-4o",
			messages: [{ role: "invalid", content: "Hello!" }],
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("validation_error");
	});

	test("rejects temperature out of range", async () => {
		const res = await postChat(app, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "Hello!" }],
			temperature: 3.0,
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("validation_error");
	});

	test("rejects negative max_tokens", async () => {
		const res = await postChat(app, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "Hello!" }],
			max_tokens: -1,
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("validation_error");
	});

	test("accepts valid optional parameters", async () => {
		const res = await postChat(app, {
			model: "gpt-4o",
			messages: [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hello!" },
			],
			temperature: 0.7,
			max_tokens: 100,
			top_p: 0.9,
			stream: false,
			stop: ["END"],
		});

		expect(res.status).toBe(200);
	});

	test("accepts stop as string or array", async () => {
		// Stop as string
		const res1 = await postChat(app, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "Hello!" }],
			stop: "END",
		});
		expect(res1.status).toBe(200);

		// Stop as array
		const res2 = await postChat(app, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "Hello!" }],
			stop: ["END", "STOP"],
		});
		expect(res2.status).toBe(200);
	});
});
