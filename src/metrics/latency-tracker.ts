/**
 * Provider latency tracker with EMA and percentile support.
 *
 * Keeps a bounded rolling window of latency samples per provider
 * and maintains an exponential moving average for fast routing decisions.
 */

import type { ProviderName } from "@/config/providers.ts";
import { loadRoutingConfig } from "@/config/routing-config.ts";
import { logger } from "@/middleware/logging.ts";
import type { LatencyRecord, LatencyStats } from "@/types/metrics.ts";
import { calculateEma, calculatePercentile } from "./aggregator.ts";

/** Internal per-provider state */
interface ProviderLatencyState {
	/** Rolling window of totalMs samples (bounded to windowSize) */
	samples: number[];
	/** Current EMA value (ms) */
	ema: number;
	/** Whether EMA has been initialised with at least one sample */
	initialised: boolean;
	/** Full latency records for introspection */
	records: LatencyRecord[];
	/** Timestamp of the last recorded sample */
	lastUpdated: number;
}

export class LatencyTracker {
	private readonly state = new Map<ProviderName, ProviderLatencyState>();
	private readonly windowSize: number;
	private readonly alpha: number;

	constructor(opts?: { windowSize?: number; alpha?: number }) {
		const config = loadRoutingConfig();
		this.windowSize = opts?.windowSize ?? config.latencyWindowSize;
		this.alpha = opts?.alpha ?? config.latencyEmaAlpha;

		logger.debug({
			msg: "LatencyTracker initialised",
			windowSize: this.windowSize,
			alpha: this.alpha,
		});
	}

	/* ------------------------------------------------------------------ */
	/*  Write path                                                         */
	/* ------------------------------------------------------------------ */

	/**
	 * Record a latency measurement for a provider.
	 * Automatically trims the rolling window when it exceeds `windowSize`.
	 */
	recordLatency(
		provider: ProviderName,
		modelId: string,
		ttfbMs: number,
		totalMs: number,
		success: boolean,
	): void {
		const now = Date.now();

		const record: LatencyRecord = {
			provider,
			modelId,
			ttfbMs,
			totalMs,
			timestamp: now,
			success,
		};

		let providerState = this.state.get(provider);

		if (!providerState) {
			providerState = {
				samples: [],
				ema: totalMs, // seed EMA with first observation
				initialised: true,
				records: [],
				lastUpdated: now,
			};
			this.state.set(provider, providerState);
		} else {
			providerState.ema = calculateEma(providerState.ema, totalMs, this.alpha);
		}

		// Append and enforce window bound
		providerState.samples.push(totalMs);
		providerState.records.push(record);

		if (providerState.samples.length > this.windowSize) {
			providerState.samples.shift();
			providerState.records.shift();
		}

		providerState.lastUpdated = now;

		logger.debug({
			msg: "latency recorded",
			provider,
			modelId,
			ttfbMs,
			totalMs,
			success,
			ema: Math.round(providerState.ema * 100) / 100,
			sampleCount: providerState.samples.length,
		});
	}

	/* ------------------------------------------------------------------ */
	/*  Read path                                                          */
	/* ------------------------------------------------------------------ */

	/**
	 * Get aggregated latency stats for a provider.
	 * Returns zero-valued stats when no data has been recorded yet.
	 */
	getStats(provider: ProviderName): LatencyStats {
		const providerState = this.state.get(provider);

		if (!providerState || providerState.samples.length === 0) {
			return {
				provider,
				sampleCount: 0,
				emaMs: 0,
				p50Ms: 0,
				p95Ms: 0,
				p99Ms: 0,
				lastUpdated: 0,
			};
		}

		return {
			provider,
			sampleCount: providerState.samples.length,
			emaMs: Math.round(providerState.ema * 100) / 100,
			p50Ms: calculatePercentile(providerState.samples, 50),
			p95Ms: calculatePercentile(providerState.samples, 95),
			p99Ms: calculatePercentile(providerState.samples, 99),
			lastUpdated: providerState.lastUpdated,
		};
	}

	/** Get the current EMA for a provider (ms). Returns 0 if no data. */
	getEma(provider: ProviderName): number {
		const providerState = this.state.get(provider);
		if (!providerState || !providerState.initialised) return 0;
		return Math.round(providerState.ema * 100) / 100;
	}

	/** Get a specific percentile for a provider. Returns 0 if no data. */
	getPercentile(provider: ProviderName, p: number): number {
		const providerState = this.state.get(provider);
		if (!providerState || providerState.samples.length === 0) return 0;
		return calculatePercentile(providerState.samples, p);
	}

	/** Reset all tracked data (useful for tests). */
	reset(): void {
		this.state.clear();
	}
}

/** Singleton instance for application-wide use */
export const latencyTracker = new LatencyTracker();
