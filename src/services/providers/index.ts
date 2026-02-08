import type { LanguageModel } from "ai";
import type { ProviderName } from "@/config/providers.ts";
import { ANTHROPIC_MODEL_PREFIXES, createAnthropicModel } from "./anthropic.ts";
import { createGoogleModel, GOOGLE_MODEL_PREFIXES } from "./google.ts";
import { createOpenAIModel, OPENAI_MODEL_PREFIXES } from "./openai.ts";

/** Model factory functions keyed by provider */
const modelFactories: Record<ProviderName, (modelId: string) => LanguageModel> = {
	openai: createOpenAIModel,
	anthropic: createAnthropicModel,
	google: createGoogleModel,
};

/**
 * Model Factory — Resolves a provider + model ID to a Vercel AI SDK LanguageModel.
 * This is the core pattern from docs/research/architecture.md
 */
export function getModel(providerId: ProviderName, modelId: string): LanguageModel {
	const factory = modelFactories[providerId];
	if (!factory) {
		throw new Error(`Unknown provider: ${providerId}`);
	}
	return factory(modelId);
}

/**
 * Auto-detect the provider based on model name prefix.
 * Returns null if no known prefix matches.
 */
export function detectProvider(modelId: string): ProviderName | null {
	for (const prefix of OPENAI_MODEL_PREFIXES) {
		if (modelId.startsWith(prefix)) return "openai";
	}
	for (const prefix of ANTHROPIC_MODEL_PREFIXES) {
		if (modelId.startsWith(prefix)) return "anthropic";
	}
	for (const prefix of GOOGLE_MODEL_PREFIXES) {
		if (modelId.startsWith(prefix)) return "google";
	}
	return null;
}

export type { ProviderName };
