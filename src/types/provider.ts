import type { ProviderName } from "@/config/providers.ts";
import type { LatencyStats } from "./metrics.ts";
import type { ModelCapability } from "./routing.ts";

/** Runtime state of a provider */
export interface ProviderState {
	id: ProviderName;
	/** Whether the provider is currently available */
	available: boolean;
	/** Rate limit tokens remaining */
	rateLimitRemaining: number;
	/** Rate limit reset timestamp */
	rateLimitResetAt: number;
	/** Current latency stats */
	latency: LatencyStats | null;
	/** Last error timestamp (null if healthy) */
	lastErrorAt: number | null;
	/** Consecutive error count (for circuit breaker) */
	consecutiveErrors: number;
}

/** Provider configuration with capabilities and pricing */
export interface ProviderProfile {
	id: ProviderName;
	/** Display name */
	name: string;
	/** Supported models */
	models: ProviderModelInfo[];
	/** Rate limits */
	rateLimit: {
		/** Requests per minute */
		rpm: number;
		/** Tokens per minute */
		tpm: number;
	};
	/** Default timeout (ms) */
	defaultTimeoutMs: number;
}

/** Information about a specific model from a provider */
export interface ProviderModelInfo {
	modelId: string;
	/** Model capabilities */
	capabilities: ModelCapability[];
	/** Context window size (tokens) */
	contextWindow: number;
	/** Max output tokens */
	maxOutputTokens: number;
	/** Cost per 1K input tokens (USD) */
	inputPer1k: number;
	/** Cost per 1K output tokens (USD) */
	outputPer1k: number;
}
