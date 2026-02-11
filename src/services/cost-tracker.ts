/**
 * Cost tracking service — per-request cost calculation and aggregation.
 * Singleton, in-memory store — same pattern as error-tracker.ts.
 *
 * Records token usage and USD cost for every LLM request,
 * broken down by provider and model. Exposes a summary for /metrics.
 */

import { getModelPricing } from "@/config/pricing.ts";
import type { ProviderName } from "@/config/providers.ts";
import { logger } from "@/middleware/logging.ts";
import type { CostRecord } from "@/types/metrics.ts";

// ── Types ────────────────────────────────────────────────

interface ProviderCostStats {
	requests: number;
	totalCost: number;
	inputTokens: number;
	outputTokens: number;
}

/** Aggregated cost tracking snapshot returned by getCostSummary(). */
export interface CostSummary {
	totalCostUsd: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	byProvider: Record<ProviderName, ProviderCostStats>;
	byModel: Record<string, { requests: number; totalCost: number }>;
	recentRequests: CostRecord[];
}

// ── Constants ────────────────────────────────────────────

/** Rolling window of recent requests kept in memory */
const MAX_RECENT_REQUESTS = 50;

/** Maximum distinct models tracked in byModel (LRU-style eviction) */
const MAX_MODEL_ENTRIES = 100;

/** Tiered cost alert thresholds (USD) — alerts fire once per tier per period */
const COST_ALERT_TIERS_USD = [10, 50, 100, 500] as const;

/** Alert reset interval — resets fired alerts so they can re-trigger (24h) */
const ALERT_RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Multiplier for rounding USD values to 4 decimal places */
const USD_PRECISION = 10_000;

// ── State ────────────────────────────────────────────────

const recentRequests: CostRecord[] = [];
let totalCostUsd = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;

/** Tracks which alert tiers have already fired in the current period */
const alertsFired = new Set<number>();

/** Timestamp of last alert reset */
let lastAlertResetAt = Date.now();

const byProvider: Record<ProviderName, ProviderCostStats> = {
	openai: { requests: 0, totalCost: 0, inputTokens: 0, outputTokens: 0 },
	anthropic: { requests: 0, totalCost: 0, inputTokens: 0, outputTokens: 0 },
	google: { requests: 0, totalCost: 0, inputTokens: 0, outputTokens: 0 },
};

const byModel: Record<string, { requests: number; totalCost: number }> = {};

// ── Helpers ──────────────────────────────────────────────

/**
 * Evict the least-used model entry when byModel exceeds MAX_MODEL_ENTRIES.
 * Removes the model with the fewest requests (ties broken by lowest cost).
 */
function evictLeastUsedModel(): void {
	const entries = Object.entries(byModel);
	if (entries.length <= MAX_MODEL_ENTRIES) return;

	let leastKey: string | null = null;
	let leastRequests = Number.POSITIVE_INFINITY;
	let leastCost = Number.POSITIVE_INFINITY;

	for (const [key, stats] of entries) {
		if (
			stats.requests < leastRequests ||
			(stats.requests === leastRequests && stats.totalCost < leastCost)
		) {
			leastKey = key;
			leastRequests = stats.requests;
			leastCost = stats.totalCost;
		}
	}

	if (leastKey !== null) {
		delete byModel[leastKey];
	}
}

/**
 * Check if cumulative cost exceeds any alert tier and log a warning.
 * Alerts reset periodically so they can re-fire in new periods.
 */
function checkCostAlerts(): void {
	const now = Date.now();

	// Reset fired alerts after the reset interval (daily)
	if (now - lastAlertResetAt >= ALERT_RESET_INTERVAL_MS) {
		alertsFired.clear();
		lastAlertResetAt = now;
	}

	for (const tier of COST_ALERT_TIERS_USD) {
		if (!alertsFired.has(tier) && totalCostUsd >= tier) {
			alertsFired.add(tier);
			logger.warn(
				{
					alert: "cost_threshold_exceeded",
					totalCostUsd: Math.round(totalCostUsd * USD_PRECISION) / USD_PRECISION,
					thresholdUsd: tier,
				},
				`Cumulative cost exceeded $${tier}`,
			);
		}
	}
}

// ── Public API ───────────────────────────────────────────

/**
 * Calculate USD cost and record it for a completed LLM request.
 *
 * Looks up per-model pricing, computes input + output cost, then updates:
 * - Global totals (cost, tokens).
 * - Per-provider aggregates.
 * - Per-model aggregates (with LRU eviction at {@link MAX_MODEL_ENTRIES}).
 * - Rolling window of recent requests.
 * - Tiered cost alerts (fires once per tier per 24 h period).
 *
 * @param provider     - The provider that served the request.
 * @param modelId      - The specific model used (e.g. `"gpt-4o"`).
 * @param inputTokens  - Number of prompt tokens consumed.
 * @param outputTokens - Number of completion tokens generated.
 * @returns The computed {@link CostRecord}, useful for logging or response headers.
 */
export function recordCost(
	provider: ProviderName,
	modelId: string,
	inputTokens: number,
	outputTokens: number,
): CostRecord {
	const pricing = getModelPricing(modelId);

	const inputCost = (inputTokens / 1000) * pricing.inputPer1k;
	const outputCost = (outputTokens / 1000) * pricing.outputPer1k;
	const costUsd = inputCost + outputCost;

	const record: CostRecord = {
		provider,
		modelId,
		inputTokens,
		outputTokens,
		costUsd,
		timestamp: Date.now(),
	};

	// Update global totals
	totalCostUsd += costUsd;
	totalInputTokens += inputTokens;
	totalOutputTokens += outputTokens;

	// Update per-provider stats
	const providerStats = byProvider[provider];
	providerStats.requests++;
	providerStats.totalCost += costUsd;
	providerStats.inputTokens += inputTokens;
	providerStats.outputTokens += outputTokens;

	// Update per-model stats (with LRU-style eviction)
	if (!byModel[modelId]) {
		byModel[modelId] = { requests: 0, totalCost: 0 };
		evictLeastUsedModel();
	}
	byModel[modelId].requests++;
	byModel[modelId].totalCost += costUsd;

	// Maintain rolling window of recent requests
	recentRequests.push(record);
	if (recentRequests.length > MAX_RECENT_REQUESTS) {
		recentRequests.shift();
	}

	// Check alert thresholds
	checkCostAlerts();

	return record;
}

/**
 * Get a point-in-time snapshot of all cost tracking data.
 *
 * Returns deep copies of internal state so callers cannot mutate the
 * singleton. Includes global totals, per-provider and per-model breakdowns,
 * and the rolling window of recent requests.
 */
export function getCostSummary(): CostSummary {
	return {
		totalCostUsd: Math.round(totalCostUsd * USD_PRECISION) / USD_PRECISION,
		totalInputTokens,
		totalOutputTokens,
		byProvider: {
			openai: { ...byProvider.openai },
			anthropic: { ...byProvider.anthropic },
			google: { ...byProvider.google },
		},
		byModel: { ...byModel },
		recentRequests: [...recentRequests],
	};
}

/** Get the current total cost (avoids importing the full summary) */
export function getTotalCost(): number {
	return totalCostUsd;
}

/**
 * Reset all cost tracking state.
 * Useful for testing, periodic resets, or administrative clearing.
 */
export function resetCostTracking(): void {
	totalCostUsd = 0;
	totalInputTokens = 0;
	totalOutputTokens = 0;
	recentRequests.length = 0;
	alertsFired.clear();
	lastAlertResetAt = Date.now();

	for (const key of Object.keys(byModel)) {
		delete byModel[key];
	}

	for (const provider of Object.keys(byProvider) as ProviderName[]) {
		byProvider[provider] = {
			requests: 0,
			totalCost: 0,
			inputTokens: 0,
			outputTokens: 0,
		};
	}

	logger.info("Cost tracking state reset");
}

/** Singleton accessor — exported as a namespace object for convenience */
export const costTracker = {
	recordCost,
	getCostSummary,
	getTotalCost,
	resetCostTracking,
} as const;
