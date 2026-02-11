/**
 * Centralized model configuration — single source of truth for pricing and capabilities.
 *
 * Loads model definitions from `models.json`, validates them with Zod at startup,
 * and exports typed accessors consumed by the routing engine, cost tracker, and
 * rules engine.
 *
 * To add or update a model, edit `models.json` — no TypeScript changes needed.
 */

import { z } from "zod/v4";
import modelsJson from "@/config/models.json";
import type { ProviderName } from "@/config/providers.ts";
import type { ModelPricing } from "@/types/metrics.ts";
import type { ModelCapability } from "@/types/routing.ts";

// ── Zod Schemas ──────────────────────────────────────────

const ModelCapabilitySchema = z.enum([
	"streaming",
	"vision",
	"function_calling",
	"json_mode",
	"long_context",
]);

const ModelEntrySchema = z.object({
	provider: z.enum(["openai", "anthropic", "google"]),
	pricing: z.object({
		inputPer1k: z.number().nonnegative(),
		outputPer1k: z.number().nonnegative(),
	}),
	capabilities: z.array(ModelCapabilitySchema),
});

const ModelsConfigSchema = z.object({
	models: z.record(z.string(), ModelEntrySchema),
});

// ── Validate at startup ──────────────────────────────────

const parsed = ModelsConfigSchema.parse(modelsJson);

// ── Derived data structures ──────────────────────────────

/**
 * Model pricing array for the routing engine.
 * Drop-in replacement for the old inline `MODEL_PRICING` in `routing-config.ts`.
 */
export const MODEL_PRICING: readonly ModelPricing[] = Object.entries(parsed.models).map(
	([modelId, entry]) => ({
		modelId,
		provider: entry.provider as ProviderName,
		inputPer1k: entry.pricing.inputPer1k,
		outputPer1k: entry.pricing.outputPer1k,
	}),
);

/**
 * Capabilities map keyed by `"provider:modelId"` for the rules engine.
 * Drop-in replacement for the old `DEFAULT_CAPABILITIES` in `rules-engine.ts`.
 */
export const CAPABILITIES_MAP: Readonly<Record<string, ModelCapability[]>> = Object.fromEntries(
	Object.entries(parsed.models).map(([modelId, entry]) => [
		`${entry.provider}:${modelId}`,
		entry.capabilities as ModelCapability[],
	]),
);

/**
 * Pricing lookup table keyed by model ID for the cost tracker.
 * Drop-in replacement for the old `PRICING_TABLE` in `pricing.ts`.
 */
const PRICING_TABLE: Readonly<Record<string, ModelPricing>> = Object.fromEntries(
	MODEL_PRICING.map((p) => [p.modelId, p]),
);

/** Default fallback pricing when a model is not in the JSON config */
const DEFAULT_PRICING: ModelPricing = {
	modelId: "unknown",
	provider: "openai",
	inputPer1k: 0.002,
	outputPer1k: 0.006,
};

/**
 * Look up pricing for a model by ID. Returns the JSON-defined pricing
 * if available, otherwise a conservative default fallback.
 */
export function getModelPricing(modelId: string): ModelPricing {
	const pricing = PRICING_TABLE[modelId];
	if (pricing) {
		return pricing;
	}
	// Return fallback with the actual modelId for logging purposes
	return { ...DEFAULT_PRICING, modelId };
}

/**
 * Look up capabilities for a model by provider and model ID.
 * Returns an empty array if the model is not in the JSON config.
 */
export function getModelCapabilities(provider: ProviderName, modelId: string): ModelCapability[] {
	return CAPABILITIES_MAP[`${provider}:${modelId}`] ?? [];
}
