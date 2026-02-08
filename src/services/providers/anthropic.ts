import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

let instance: ReturnType<typeof createAnthropic> | null = null;

function getProvider(): ReturnType<typeof createAnthropic> {
	if (!instance) {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) {
			throw new Error("ANTHROPIC_API_KEY is not configured");
		}
		instance = createAnthropic({ apiKey });
	}
	return instance;
}

export function createAnthropicModel(modelId: string): LanguageModel {
	return getProvider()(modelId);
}

/** Known Anthropic model prefixes for auto-detection */
export const ANTHROPIC_MODEL_PREFIXES = ["claude-"];
