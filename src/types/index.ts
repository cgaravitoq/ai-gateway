import { z } from "zod/v4";

// ── OpenAI-compatible Request Types ─────────────────────────

/** Zod schema for a single chat message */
export const MessageSchema = z.object({
	role: z.enum(["system", "user", "assistant"]),
	content: z.string().max(100000),
});

/** Zod schema for the POST /v1/chat/completions request body */
export const ChatCompletionRequestSchema = z.object({
	model: z.string().max(128),
	messages: z.array(MessageSchema).min(1).max(256),
	temperature: z.number().min(0).max(2).optional(),
	max_tokens: z.number().int().positive().optional(),
	top_p: z.number().min(0).max(1).optional(),
	stream: z.boolean().optional().default(false),
	stop: z.union([z.string(), z.array(z.string())]).optional(),
});

/** Inferred type for a validated chat completion request */
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

/** Inferred type for a single chat message */
export type Message = z.infer<typeof MessageSchema>;

// ── OpenAI-compatible Response Types ────────────────────────

/** A single choice in a non-streaming chat completion response */
export interface ChatCompletionChoice {
	index: number;
	message: {
		role: "assistant";
		content: string;
	};
	finish_reason: string | null;
}

/** Full non-streaming chat completion response (OpenAI format) */
export interface ChatCompletionResponse {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	choices: ChatCompletionChoice[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

// ── Streaming Response Types ────────────────────────────────

/** A single choice in a streaming chunk */
export interface ChatCompletionChunkChoice {
	index: number;
	delta: {
		role?: "assistant";
		content?: string;
	};
	finish_reason: string | null;
}

/** A single SSE chunk in a streaming chat completion response */
export interface ChatCompletionChunk {
	id: string;
	object: "chat.completion.chunk";
	created: number;
	model: string;
	choices: ChatCompletionChunkChoice[];
}

// ── Error Types ─────────────────────────────────────────────

/** OpenAI-compatible error response envelope */
export interface GatewayError {
	error: {
		message: string;
		type: string;
		code: string | number;
		provider?: string;
	};
}
