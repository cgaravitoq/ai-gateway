import type { ProviderName } from "@/config/providers.ts";
import type { ModelPricing } from "@/types/metrics.ts";

/**
 * Pricing data version — update this when prices are refreshed.
 * Used for staleness tracking (compare against current date).
 */
export const PRICING_VERSION = "2025-02-11";

/**
 * Factory function to create a ModelPricing entry with proper typing.
 * Eliminates the need for 'as ProviderName' type assertions.
 */
function createPricing(
	modelId: string,
	provider: ProviderName,
	inputPer1k: number,
	outputPer1k: number,
): ModelPricing {
	return { modelId, provider, inputPer1k, outputPer1k };
}

/**
 * Model pricing table — approximate USD costs per 1K tokens.
 * Updated periodically; does not need to be exact.
 */
const PRICING_TABLE: Record<string, ModelPricing> = {
	// OpenAI
	"gpt-4o": createPricing("gpt-4o", "openai", 0.0025, 0.01),
	"gpt-4o-mini": createPricing("gpt-4o-mini", "openai", 0.00015, 0.0006),
	"gpt-3.5-turbo": createPricing("gpt-3.5-turbo", "openai", 0.0005, 0.0015),

	// Anthropic
	"claude-3.5-sonnet": createPricing("claude-3.5-sonnet", "anthropic", 0.003, 0.015),
	"claude-sonnet-4-20250514": createPricing("claude-sonnet-4-20250514", "anthropic", 0.003, 0.015),
	"claude-3-haiku": createPricing("claude-3-haiku", "anthropic", 0.00025, 0.00125),
	"claude-haiku-3-5": createPricing("claude-haiku-3-5", "anthropic", 0.0008, 0.004),

	// Google
	"gemini-1.5-pro": createPricing("gemini-1.5-pro", "google", 0.00125, 0.005),
	"gemini-1.5-flash": createPricing("gemini-1.5-flash", "google", 0.000075, 0.0003),
	"gemini-2.0-flash": createPricing("gemini-2.0-flash", "google", 0.0001, 0.0004),
	"gemini-2.0-pro": createPricing("gemini-2.0-pro", "google", 0.00125, 0.005),
};

/** Default fallback pricing when model is not in the table */
const DEFAULT_PRICING: ModelPricing = createPricing("unknown", "openai", 0.002, 0.006);

/**
 * Look up pricing for a model. Returns exact match if available,
 * otherwise returns a conservative default fallback.
 */
export function getModelPricing(modelId: string): ModelPricing {
	const pricing = PRICING_TABLE[modelId];
	if (pricing) {
		return pricing;
	}

	// Return fallback with the actual modelId for logging purposes
	return { ...DEFAULT_PRICING, modelId };
}
