import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ChatCompletionRequestSchema } from "@/types/index.ts";

const chat = new Hono();

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

		// TODO: Wire in router + provider adapters in Task 4
		return c.json(
			{
				error: {
					message: `Model "${body.model}" routing not yet implemented`,
					type: "not_implemented",
					code: "not_implemented",
				},
			},
			501,
		);
	},
);

export { chat };
