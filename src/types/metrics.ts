import type { ProviderName } from "@/config/providers.ts";

/** A single latency measurement */
export interface LatencyRecord {
	provider: ProviderName;
	modelId: string;
	/** Time to first byte (ms) */
	ttfbMs: number;
	/** Total request duration (ms) */
	totalMs: number;
	/** Timestamp of measurement */
	timestamp: number;
	/** Whether the request succeeded */
	success: boolean;
}

/** Aggregated latency statistics for a provider */
export interface LatencyStats {
	provider: ProviderName;
	/** Number of samples in the window */
	sampleCount: number;
	/** Exponential moving average (ms) */
	emaMs: number;
	/** Percentiles */
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	/** Last updated timestamp */
	lastUpdated: number;
}

/** Cost record for a single request */
export interface CostRecord {
	provider: ProviderName;
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	/** Total cost in USD */
	costUsd: number;
	timestamp: number;
}

/** Token pricing per model */
export interface ModelPricing {
	modelId: string;
	provider: ProviderName;
	/** Cost per 1K input tokens (USD) */
	inputPer1k: number;
	/** Cost per 1K output tokens (USD) */
	outputPer1k: number;
}
