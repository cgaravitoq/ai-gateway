import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { env } from "@/config/env.ts";

let instance: ReturnType<typeof createOpenAI> | null = null;

function getProvider(): ReturnType<typeof createOpenAI> {
	if (!instance) {
		instance = createOpenAI({ apiKey: env.OPENAI_API_KEY });
	}
	return instance;
}

export function createOpenAIModel(modelId: string): LanguageModel {
	return getProvider()(modelId);
}

/** Known OpenAI model prefixes for auto-detection */
export const OPENAI_MODEL_PREFIXES = ["gpt-", "o1-", "o3-", "chatgpt-"];
