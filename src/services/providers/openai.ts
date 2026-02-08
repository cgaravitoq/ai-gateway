import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

let instance: ReturnType<typeof createOpenAI> | null = null;

function getProvider(): ReturnType<typeof createOpenAI> {
	if (!instance) {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			throw new Error("OPENAI_API_KEY is not configured");
		}
		instance = createOpenAI({ apiKey });
	}
	return instance;
}

export function createOpenAIModel(modelId: string): LanguageModel {
	return getProvider()(modelId);
}

/** Known OpenAI model prefixes for auto-detection */
export const OPENAI_MODEL_PREFIXES = ["gpt-", "o1-", "o3-", "chatgpt-"];
