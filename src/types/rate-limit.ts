import type { ProviderName } from "@/config/providers.ts";

/** Per-provider rate limit configuration */
export interface ProviderRateLimitConfig {
	/** Maximum tokens (requests) the bucket can hold */
	maxTokens: number;
	/** Tokens added per second */
	refillRate: number;
}

/** Top-level rate limit configuration for all providers */
export interface RateLimitConfig {
	/** Whether rate limiting is enabled */
	enabled: boolean;
	/** Per-provider limits (keyed by provider name) */
	providers: Record<ProviderName, ProviderRateLimitConfig>;
}

/** Current state of a provider's rate limit bucket */
export interface RateLimitState {
	/** Provider this state belongs to */
	provider: ProviderName;
	/** Current number of tokens available */
	remaining: number;
	/** Maximum tokens the bucket can hold */
	limit: number;
	/** Seconds until at least one token is available (0 if tokens available) */
	retryAfter: number;
}
