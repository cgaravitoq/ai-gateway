import { z } from "zod/v4";

// --- OpenAI-compatible Request Types ---

export const MessageSchema = z.object({
	role: z.enum(["system", "user", "assistant"]),
	content: z.string(),
});

export const ChatCompletionRequestSchema = z.object({
	model: z.string(),
	messages: z.array(MessageSchema).min(1),
	temperature: z.number().min(0).max(2).optional(),
	max_tokens: z.number().int().positive().optional(),
	top_p: z.number().min(0).max(1).optional(),
	stream: z.boolean().optional().default(false),
	stop: z.union([z.string(), z.array(z.string())]).optional(),
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type Message = z.infer<typeof MessageSchema>;

// --- OpenAI-compatible Response Types ---

export interface ChatCompletionChoice {
	index: number;
	message: {
		role: "assistant";
		content: string;
	};
	finish_reason: string | null;
}

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

// --- Streaming Response Types ---

export interface ChatCompletionChunkChoice {
	index: number;
	delta: {
		role?: "assistant";
		content?: string;
	};
	finish_reason: string | null;
}

export interface ChatCompletionChunk {
	id: string;
	object: "chat.completion.chunk";
	created: number;
	model: string;
	choices: ChatCompletionChunkChoice[];
}

// --- Error Types ---

export interface GatewayError {
	error: {
		message: string;
		type: string;
		code: string | number;
		provider?: string;
	};
}
