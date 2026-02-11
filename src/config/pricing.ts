/**
 * Pricing module — delegates to the centralized `models.ts` for core models
 * and supplements with legacy model pricing for backward compatibility.
 *
 * The cost tracker (`cost-tracker.ts`) imports `getModelPricing` from here.
 * Core model prices are defined in `models.json`; legacy aliases live below.
 */

import { getModelPricing as getCoreModelPricing } from "@/config/models.ts";
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
 * Legacy / alias models not present in `models.json`.
 * Kept here so cost tracking still works for older model identifiers.
 */
const LEGACY_PRICING: Record<string, ModelPricing> = {
	"gpt-3.5-turbo": createPricing("gpt-3.5-turbo", "openai", 0.0005, 0.0015),
	"claude-3.5-sonnet": createPricing("claude-3.5-sonnet", "anthropic", 0.003, 0.015),
	"claude-3-haiku": createPricing("claude-3-haiku", "anthropic", 0.00025, 0.00125),
	"gemini-1.5-pro": createPricing("gemini-1.5-pro", "google", 0.00125, 0.005),
	"gemini-1.5-flash": createPricing("gemini-1.5-flash", "google", 0.000075, 0.0003),
};

/**
 * Look up pricing for a model. Checks the core `models.json` config first,
 * then falls back to legacy pricing, then to a conservative default.
 */
export function getModelPricing(modelId: string): ModelPricing {
	// Try core config (models.json) first
	const core = getCoreModelPricing(modelId);
	if (core.modelId !== "unknown") {
		return core;
	}

	// Try legacy aliases
	const legacy = LEGACY_PRICING[modelId];
	if (legacy) {
		return legacy;
	}

	// Default fallback (returned by getCoreModelPricing with modelId patched)
	return core;
}
