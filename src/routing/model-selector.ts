import type { ProviderName } from "@/config/providers.ts";
import {
	DEFAULT_ROUTING_RULES,
	loadRoutingConfig,
	MODEL_PRICING,
} from "@/config/routing-config.ts";
import { latencyTracker } from "@/metrics/latency-tracker.ts";
import { logger } from "@/middleware/logging.ts";
import { FallbackHandler } from "@/routing/fallback-handler.ts";
import { providerRegistry } from "@/routing/provider-registry.ts";
import { RoutingRulesEngine } from "@/routing/rules-engine.ts";
import type { ProviderState } from "@/types/provider.ts";
import type { RankedProvider, RequestMetadata } from "@/types/routing.ts";

const config = loadRoutingConfig();

/**
 * ModelSelector — the top-level orchestrator for Phase 3 smart routing.
 *
 * Flow:
 * 1. Build current `ProviderState[]` from the registry
 * 2. Evaluate routing rules to score & rank providers
 * 3. Filter out providers that are rate-limited or circuit-broken
 * 4. Use latency EMA as a tiebreaker
 * 5. Return the top-ranked provider
 */
export class ModelSelector {
	private readonly rulesEngine: RoutingRulesEngine;
	private readonly fallbackHandler: FallbackHandler;

	constructor() {
		this.rulesEngine = new RoutingRulesEngine(DEFAULT_ROUTING_RULES, MODEL_PRICING);
		this.fallbackHandler = new FallbackHandler({
			maxRetries: config.maxRetries,
			baseBackoffMs: config.retryBackoffBaseMs,
			totalTimeoutMs: config.defaultTimeoutMs,
		});
	}

	// ── Primary selection ───────────────────────────────────

	/**
	 * Select the best available provider for a given request.
	 *
	 * @throws {Error} when no providers are available after filtering.
	 */
	async selectProvider(request: RequestMetadata): Promise<RankedProvider> {
		// 1. Snapshot current runtime state
		const providerStates = providerRegistry.getProviderStates();

		// 2. Score & rank with the rules engine
		const ranked: RankedProvider[] = this.rulesEngine.evaluate(request, providerStates);

		// 3. Filter by availability (circuit breaker) and rate-limit headroom
		const available = ranked.filter((r: RankedProvider) => {
			const state = providerStates.find((s: ProviderState) => s.id === r.provider);
			if (!state) return false;
			if (!state.available) return false;
			if (state.rateLimitRemaining <= 0) return false;
			return true;
		});

		if (available.length === 0) {
			logger.error(
				{ model: request.model, totalProviders: ranked.length },
				"no providers available after filtering",
			);
			throw new Error(
				`No providers available for model "${request.model}" — all are rate-limited or circuit-broken`,
			);
		}

		// 4. Tiebreaker — sort equal-score providers by latency EMA (lower is better)
		available.sort((a: RankedProvider, b: RankedProvider) => {
			if (a.score !== b.score) return b.score - a.score; // higher score first

			const latA = latencyTracker.getStats(a.provider).emaMs || Number.POSITIVE_INFINITY;
			const latB = latencyTracker.getStats(b.provider).emaMs || Number.POSITIVE_INFINITY;
			return latA - latB; // lower latency first
		});

		// Safe access — we already verified available.length > 0 above
		const selected = available[0] as RankedProvider;

		logger.info(
			{
				model: request.model,
				selectedProvider: selected.provider,
				selectedModel: selected.modelId,
				score: selected.score,
				candidates: available.length,
			},
			"provider selected",
		);

		return selected;
	}

	// ── Selection with automatic fallback ───────────────────

	/**
	 * Select a provider and execute `executeFn` with automatic retry / fallback.
	 *
	 * If the first-choice provider fails, the fallback handler retries with
	 * the next-best provider(s) according to the ranking.
	 *
	 * @param request   - Routing metadata for the current request.
	 * @param executeFn - Function that performs the actual LLM call.
	 *                    Receives the selected provider name and model ID.
	 * @returns The result of `executeFn`.
	 */
	async selectWithFallback<T>(
		request: RequestMetadata,
		executeFn: (provider: ProviderName, modelId: string) => Promise<T>,
	): Promise<T> {
		// Build the ordered candidate list once
		const providerStates = providerRegistry.getProviderStates();
		const ranked: RankedProvider[] = this.rulesEngine
			.evaluate(request, providerStates)
			.filter((r: RankedProvider) => {
				const state = providerStates.find((s: ProviderState) => s.id === r.provider);
				return state?.available && (state.rateLimitRemaining ?? 0) > 0;
			});

		if (ranked.length === 0) {
			throw new Error(
				`No providers available for model "${request.model}" — all are rate-limited or circuit-broken`,
			);
		}

		// Sort with latency tiebreaker
		ranked.sort((a: RankedProvider, b: RankedProvider) => {
			if (a.score !== b.score) return b.score - a.score;
			const latA = latencyTracker.getStats(a.provider).emaMs || Number.POSITIVE_INFINITY;
			const latB = latencyTracker.getStats(b.provider).emaMs || Number.POSITIVE_INFINITY;
			return latA - latB;
		});

		// Map ranked providers to string[] for the fallback handler API
		const providerIds = ranked.map((r) => r.provider);
		// Build a lookup so the execute function can resolve modelId from provider name
		const providerModelMap = new Map(ranked.map((r) => [r.provider, r.modelId]));

		const result = await this.fallbackHandler.executeWithFallback(
			providerIds,
			async (provider: string, _signal: AbortSignal) => {
				const modelId = providerModelMap.get(provider as ProviderName) ?? request.model;
				const start = Date.now();
				try {
					const execResult = await executeFn(provider as ProviderName, modelId);
					providerRegistry.reportSuccess(provider as ProviderName, modelId, Date.now() - start);
					return execResult;
				} catch (error) {
					providerRegistry.reportError(provider as ProviderName, modelId, error);
					throw error; // re-throw so fallback handler can try next
				}
			},
			{ streaming: request.stream },
		);

		return result.result;
	}
}

/** Singleton instance used across the gateway. */
export const modelSelector = new ModelSelector();
