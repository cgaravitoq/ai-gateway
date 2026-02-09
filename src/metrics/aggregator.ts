/**
 * Statistical aggregation helpers for latency metrics.
 * Pure functions — no side effects, no state.
 */

/**
 * Calculate a percentile value from an array of numeric samples.
 * Uses the nearest-rank method.
 *
 * @param samples  Array of numeric values (need not be sorted)
 * @param percentile  Percentile to compute (0–100, e.g. 50, 95, 99)
 * @returns The percentile value, or 0 if samples is empty
 */
export function calculatePercentile(samples: number[], percentile: number): number {
	if (samples.length === 0) return 0;
	if (percentile < 0 || percentile > 100) {
		throw new RangeError(`percentile must be 0–100, got ${percentile}`);
	}

	const sorted = [...samples].sort((a, b) => a - b);

	if (percentile === 0) return sorted[0] as number;
	if (percentile === 100) return sorted[sorted.length - 1] as number;

	// Nearest-rank: index = ceil(p/100 * N) - 1
	const rank = Math.ceil((percentile / 100) * sorted.length) - 1;
	return sorted[Math.max(0, rank)] as number;
}

/**
 * Compute an exponential moving average (EMA) update.
 *
 * EMA_new = alpha * newValue + (1 - alpha) * currentEma
 *
 * @param currentEma  Previous EMA value (use newValue for the first sample)
 * @param newValue    Latest observation
 * @param alpha       Smoothing factor (0–1). Higher = more weight on new data.
 * @returns Updated EMA
 */
export function calculateEma(currentEma: number, newValue: number, alpha: number): number {
	if (alpha < 0 || alpha > 1) {
		throw new RangeError(`alpha must be 0–1, got ${alpha}`);
	}
	return alpha * newValue + (1 - alpha) * currentEma;
}
