import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

let instance: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function getProvider(): ReturnType<typeof createGoogleGenerativeAI> {
	if (!instance) {
		const apiKey = process.env.GOOGLE_API_KEY;
		if (!apiKey) {
			throw new Error("GOOGLE_API_KEY is not configured");
		}
		instance = createGoogleGenerativeAI({ apiKey });
	}
	return instance;
}

export function createGoogleModel(modelId: string): LanguageModel {
	return getProvider()(modelId);
}

/** Known Google model prefixes for auto-detection */
export const GOOGLE_MODEL_PREFIXES = ["gemini-"];
