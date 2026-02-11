import type { ModelPricing } from "@/types/metrics.ts";
import type { ProviderState } from "@/types/provider.ts";
import type { ModelCapability, RuleCondition } from "@/types/routing.ts";

/**
 * Evaluate a cost rule condition against a provider's pricing.
 * Returns true if the provider's average cost per 1K tokens is within the threshold.
 */
export function evaluateCostRule(
	condition: Extract<RuleCondition, { type: "cost" }>,
	provider: ProviderState,
	pricing: readonly ModelPricing[],
): boolean {
	const providerPricing = pricing.filter((p) => p.provider === provider.id);

	if (providerPricing.length === 0) {
		// No pricing data — cannot satisfy cost constraint
		return false;
	}

	// Check if any model from this provider meets the cost threshold
	// TODO: Use weighted average based on RequestMetadata I/O token ratio
	// instead of simple average when RequestMetadata is passed through
	return providerPricing.some((p) => {
		const avgCostPer1k = (p.inputPer1k + p.outputPer1k) / 2;
		return avgCostPer1k <= condition.maxCostPer1kTokens;
	});
}

/**
 * Evaluate a latency rule condition against a provider's current latency stats.
 * Returns true if the provider's p95 latency is within the threshold.
 */
export function evaluateLatencyRule(
	condition: Extract<RuleCondition, { type: "latency" }>,
	provider: ProviderState,
): boolean {
	if (!provider.latency) {
		// No latency data — conservative: reject unknown providers for latency rules
		return false;
	}

	// Use p95 as the latency measure for reliability
	return provider.latency.p95Ms <= condition.maxMs;
}

/**
 * Evaluate a capability rule condition against a provider's model capabilities.
 * Returns true if the provider supports all required capabilities.
 */
export function evaluateCapabilityRule(
	condition: Extract<RuleCondition, { type: "capability" }>,
	_provider: ProviderState,
	providerCapabilities: ModelCapability[],
): boolean {
	return condition.required.every((cap) => providerCapabilities.includes(cap));
}

/**
 * Evaluate any rule condition by dispatching to the appropriate evaluator.
 */
export function evaluateCondition(
	condition: RuleCondition,
	provider: ProviderState,
	pricing: readonly ModelPricing[],
	providerCapabilities: ModelCapability[],
): boolean {
	switch (condition.type) {
		case "cost":
			return evaluateCostRule(condition, provider, pricing);
		case "latency":
			return evaluateLatencyRule(condition, provider);
		case "capability":
			return evaluateCapabilityRule(condition, provider, providerCapabilities);
	}
}
