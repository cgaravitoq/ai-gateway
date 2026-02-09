import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { env } from "@/config/env.ts";

let instance: ReturnType<typeof createAnthropic> | null = null;

function getProvider(): ReturnType<typeof createAnthropic> {
	if (!instance) {
		if (!env.ANTHROPIC_API_KEY) {
			throw new Error("ANTHROPIC_API_KEY is not configured");
		}
		instance = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
	}
	return instance;
}

export function createAnthropicModel(modelId: string): LanguageModel {
	return getProvider()(modelId);
}

/** Known Anthropic model prefixes for auto-detection */
export const ANTHROPIC_MODEL_PREFIXES = ["claude-"];
