/**
 * Simple in-memory metrics store for cache and gateway stats.
 * Tracks hit/miss/skip counters, latency, and embedding costs.
 */

interface CacheMetrics {
	hits: number;
	misses: number;
	skips: number;
	errors: number;
	avgHitLatencyMs: number;
	avgMissLatencyMs: number;
	totalEmbeddingCalls: number;
}

interface GatewayMetrics {
	totalRequests: number;
	startedAt: string;
	cache: CacheMetrics;
}

// In-memory counters
let hits = 0;
let misses = 0;
let skips = 0;
let errors = 0;
let hitLatencySum = 0;
let missLatencySum = 0;
let embeddingCalls = 0;
let totalRequests = 0;

const startedAt = new Date().toISOString();

/** Record a cache hit with the lookup latency in ms */
export function recordCacheHit(latencyMs: number): void {
	hits++;
	hitLatencySum += latencyMs;
}

/** Record a cache miss with the lookup latency in ms */
export function recordCacheMiss(latencyMs: number): void {
	misses++;
	missLatencySum += latencyMs;
}

/** Record a cache skip (e.g., streaming, X-Skip-Cache, disabled) */
export function recordCacheSkip(): void {
	skips++;
}

/** Record a cache error */
export function recordCacheError(): void {
	errors++;
}

/** Record an embedding API call */
export function recordEmbeddingCall(): void {
	embeddingCalls++;
}

/** Record any request to the gateway */
export function recordRequest(): void {
	totalRequests++;
}

/** Get a snapshot of all metrics */
export function getMetrics(): GatewayMetrics {
	return {
		totalRequests,
		startedAt,
		cache: {
			hits,
			misses,
			skips,
			errors,
			avgHitLatencyMs: hits > 0 ? Math.round(hitLatencySum / hits) : 0,
			avgMissLatencyMs: misses > 0 ? Math.round(missLatencySum / misses) : 0,
			totalEmbeddingCalls: embeddingCalls,
		},
	};
}
