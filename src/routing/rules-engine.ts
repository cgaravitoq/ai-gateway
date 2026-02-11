import { CAPABILITIES_MAP } from "@/config/models.ts";
import type { ModelPricing } from "@/types/metrics.ts";
import type { ProviderState } from "@/types/provider.ts";
import type {
	ModelCapability,
	RankedProvider,
	RequestMetadata,
	RoutingRule,
} from "@/types/routing.ts";
import { evaluateCondition } from "./rule-evaluator.ts";

/**
 * Score weights for the balanced routing strategy.
 *
 * - **latency (0.4):** Weighted highest because user-perceived responsiveness
 *   is the strongest signal for LLM API quality.
 * - **cost (0.3):** Significant weight — keeps spend in check without
 *   sacrificing responsiveness.
 * - **capability (0.3):** Ensures models that match the request's feature
 *   requirements (vision, function calling, etc.) are still preferred.
 */
const BALANCED_WEIGHTS = {
	cost: 0.3,
	latency: 0.4,
	capability: 0.3,
} as const;

/** Preference boost factor per rule-priority point */
const PREFERENCE_BOOST_FACTOR = 0.05;

/** Default capability score normalizer (models with 5+ capabilities get a full score) */
const MAX_CAPABILITY_BASELINE = 5;

/** Default fallback latency (ms) for providers with no recorded data */
const DEFAULT_LATENCY_MS = 500;

/**
 * Default model capabilities loaded from `models.json` via `CAPABILITIES_MAP`.
 *
 * This map is the initial seed — callers can extend or override it by passing
 * a custom `capabilities` map to the `RoutingRulesEngine` constructor.
 *
 * To add a new model, edit `src/config/models.json` or supply a runtime
 * override via `RoutingRulesEngine.withCapabilities()`.
 */
const DEFAULT_CAPABILITIES: Record<string, ModelCapability[]> = { ...CAPABILITIES_MAP };

/**
 * RoutingRulesEngine evaluates providers against routing rules
 * and returns a ranked list using multi-criteria scoring.
 *
 * Scoring formula (balanced strategy):
 *   score = (1 - normalizedCost) * 0.3 + (1 - normalizedLatency) * 0.4 + capabilityMatch * 0.3
 */
export class RoutingRulesEngine {
	private readonly rules: RoutingRule[];
	private readonly pricing: readonly ModelPricing[];
	private readonly capabilities: Record<string, ModelCapability[]>;

	constructor(
		rules: RoutingRule[],
		pricing: readonly ModelPricing[],
		capabilities?: Record<string, ModelCapability[]>,
	) {
		if (pricing.length === 0) {
			throw new Error("RoutingRulesEngine requires non-empty pricing data");
		}

		// Sort rules by priority descending (higher priority first)
		this.rules = [...rules].sort((a, b) => b.priority - a.priority);
		this.pricing = pricing;
		// Merge caller-supplied overrides on top of the built-in defaults
		this.capabilities = { ...DEFAULT_CAPABILITIES, ...capabilities };
	}

	/**
	 * Create a new engine instance with additional capability entries merged
	 * on top of the current set.
	 *
	 * Useful for runtime registration of new models without mutating the
	 * original engine. The returned instance shares rule and pricing data
	 * but has an extended capabilities map.
	 *
	 * @param extra - Capability entries keyed by `"provider:modelId"`.
	 * @returns A new `RoutingRulesEngine` with the merged capabilities.
	 */
	withCapabilities(extra: Record<string, ModelCapability[]>): RoutingRulesEngine {
		return new RoutingRulesEngine(this.rules, this.pricing, {
			...this.capabilities,
			...extra,
		});
	}

	/**
	 * Evaluate all providers against the configured rules and return ranked results.
	 *
	 * **Pipeline:**
	 * 1. Filter providers by availability and rate-limit headroom.
	 * 2. Build candidate pairs (provider × model) that satisfy capability requirements.
	 * 3. Match routing rules against each candidate.
	 * 4. Exclude candidates flagged by rule-based exclusions.
	 * 5. Score using the balanced formula and sort descending.
	 *
	 * @param request   - Metadata about the incoming request (model, hints, capabilities).
	 * @param providers - Live state of all registered providers.
	 * @returns Ranked list of providers, best first. Empty if none qualify.
	 */
	evaluate(request: RequestMetadata, providers: ProviderState[]): RankedProvider[] {
		// Step 1: Filter providers by availability and rate limits
		const availableProviders = this.filterAvailable(providers);

		if (availableProviders.length === 0) {
			return [];
		}

		// Step 2: Match each provider with its best model for this request
		const candidates = this.buildCandidates(availableProviders, request);

		if (candidates.length === 0) {
			return [];
		}

		// Step 3: Evaluate rules against each candidate
		const evaluated = candidates.map((candidate) => ({
			...candidate,
			matchedRules: this.evaluateRules(candidate.provider, candidate.capabilities),
		}));

		// Step 4: Apply rule-based exclusions
		const filtered = this.applyExclusions(evaluated, request);

		if (filtered.length === 0) {
			return [];
		}

		// Step 5: Score and rank
		return this.scoreAndRank(filtered, request);
	}

	/** Filter out unavailable providers and those at rate limit */
	private filterAvailable(providers: ProviderState[]): ProviderState[] {
		const now = Date.now();
		return providers.filter((p) => {
			// Must be marked available
			if (!p.available) return false;

			// Must have rate limit remaining (or reset time has passed)
			if (p.rateLimitRemaining <= 0 && p.rateLimitResetAt > now) {
				return false;
			}

			return true;
		});
	}

	/** Build candidate list: pair each provider with its best matching model */
	private buildCandidates(
		providers: ProviderState[],
		request: RequestMetadata,
	): ProviderCandidate[] {
		const candidates: ProviderCandidate[] = [];

		for (const provider of providers) {
			// Find all models for this provider in pricing
			const providerModels = this.pricing.filter((p) => p.provider === provider.id);

			for (const model of providerModels) {
				const capKey = `${provider.id}:${model.modelId}`;
				const capabilities = this.capabilities[capKey] ?? [];

				// Check if model meets request's required capabilities
				const meetsCapabilities = this.checkCapabilities(
					request.requiredCapabilities,
					capabilities,
				);

				// Check streaming requirement
				if (request.stream && !capabilities.includes("streaming")) {
					continue;
				}

				if (!meetsCapabilities) continue;

				candidates.push({
					provider,
					modelId: model.modelId,
					pricing: model,
					capabilities,
					matchedRules: [],
				});
			}
		}

		return candidates;
	}

	/** Check if provider capabilities satisfy the request requirements */
	private checkCapabilities(
		required: ModelCapability[] | undefined,
		available: ModelCapability[],
	): boolean {
		if (!required || required.length === 0) return true;
		return required.every((cap) => available.includes(cap));
	}

	/** Evaluate all rules against a provider, returning matched rule IDs */
	private evaluateRules(provider: ProviderState, capabilities: ModelCapability[]): string[] {
		const matched: string[] = [];

		for (const rule of this.rules) {
			const passes = evaluateCondition(rule.condition, provider, this.pricing, capabilities);

			if (passes) {
				matched.push(rule.id);
			}
		}

		return matched;
	}

	/** Remove candidates that are excluded by matched rules */
	private applyExclusions(
		candidates: ProviderCandidate[],
		request: RequestMetadata,
	): ProviderCandidate[] {
		return candidates.filter((candidate) => {
			for (const rule of this.rules) {
				// Check if rule applies based on request hints
				if (!this.ruleApplies(rule, request)) continue;

				// If provider is in the exclude list for a matching rule, remove it
				if (rule.excludeProviders?.includes(candidate.provider.id)) {
					const passes = evaluateCondition(
						rule.condition,
						candidate.provider,
						this.pricing,
						candidate.capabilities,
					);
					if (passes) return false;
				}
			}
			return true;
		});
	}

	/** Check if a rule is relevant to the current request */
	private ruleApplies(rule: RoutingRule, request: RequestMetadata): boolean {
		const hints = request.routingHints;
		if (!hints) return true; // No hints — all rules apply

		switch (rule.condition.type) {
			case "cost":
				// Apply cost rules if the request has a cost hint
				return hints.maxCostPer1kTokens !== undefined || hints.strategy === "cost";
			case "latency":
				// Apply latency rules if the request has a latency hint
				return hints.maxLatencyMs !== undefined || hints.strategy === "latency";
			case "capability":
				// Capability rules always apply
				return true;
		}
	}

	/** Score all candidates and return sorted RankedProvider[] */
	private scoreAndRank(
		candidates: ProviderCandidate[],
		request: RequestMetadata,
	): RankedProvider[] {
		// Compute raw values for normalization
		const costs = candidates.map((c) => this.computeCost(c.pricing));
		const latencies = candidates.map((c) => this.computeLatency(c.provider));

		const maxCost = Math.max(...costs);
		const minCost = Math.min(...costs);
		const maxLatency = Math.max(...latencies);
		const minLatency = Math.min(...latencies);

		const scored: RankedProvider[] = candidates.map((candidate, i) => {
			const cost = costs[i] ?? 0;
			const latency = latencies[i] ?? 500;

			// Normalize to [0, 1] range where 0 = best (cheapest/fastest)
			// When all candidates are equal (min===max), normalize to 0 (best score)
			const normalizedCost = maxCost === minCost ? 0 : (cost - minCost) / (maxCost - minCost);
			const normalizedLatency =
				maxLatency === minLatency ? 0 : (latency - minLatency) / (maxLatency - minLatency);

			// Linear inversion: lower cost/latency → higher score
			const costScore = 1 - normalizedCost;
			const latencyScore = 1 - normalizedLatency;

			// Capability match: fraction of requested capabilities met
			const capabilityScore = this.computeCapabilityScore(
				request.requiredCapabilities,
				candidate.capabilities,
			);

			// Balanced composite score
			const score =
				costScore * BALANCED_WEIGHTS.cost +
				latencyScore * BALANCED_WEIGHTS.latency +
				capabilityScore * BALANCED_WEIGHTS.capability;

			// Apply preference boost from matched rules
			const preferenceBoost = this.computePreferenceBoost(candidate);

			return {
				provider: candidate.provider.id,
				modelId: candidate.modelId,
				score: score + preferenceBoost,
				matchedRules: candidate.matchedRules,
			};
		});

		// Sort by score descending (highest first)
		return scored.sort((a, b) => b.score - a.score);
	}

	/** Compute cost metric for a model (average of input+output per 1K tokens) */
	private computeCost(pricing: ModelPricing): number {
		return (pricing.inputPer1k + pricing.outputPer1k) / 2;
	}

	/** Compute latency metric for a provider (EMA or fallback) */
	private computeLatency(provider: ProviderState): number {
		if (provider.latency) {
			return provider.latency.emaMs;
		}
		return DEFAULT_LATENCY_MS;
	}

	/** Compute capability match score [0, 1] */
	private computeCapabilityScore(
		required: ModelCapability[] | undefined,
		available: ModelCapability[],
	): number {
		if (!required || required.length === 0) {
			// No requirements — full score based on total capabilities
			// More capabilities is slightly better
			return Math.min(available.length / MAX_CAPABILITY_BASELINE, 1);
		}

		const matched = required.filter((cap) => available.includes(cap));
		return matched.length / required.length;
	}

	/** Compute a score boost for providers preferred by matched rules */
	private computePreferenceBoost(candidate: ProviderCandidate): number {
		let boost = 0;

		for (const rule of this.rules) {
			// Only boost if the rule matched for this candidate
			if (!candidate.matchedRules.includes(rule.id)) continue;

			// Boost preferred providers proportional to rule priority
			if (rule.preferredProviders?.includes(candidate.provider.id)) {
				boost += rule.priority * PREFERENCE_BOOST_FACTOR;
			}
		}

		return boost;
	}
}

/** Internal candidate representation during evaluation */
interface ProviderCandidate {
	provider: ProviderState;
	modelId: string;
	pricing: ModelPricing;
	capabilities: ModelCapability[];
	matchedRules: string[];
}
