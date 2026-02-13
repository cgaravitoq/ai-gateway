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
 * Calculate multiple percentiles from the same dataset with a single sort pass.
 * Uses the nearest-rank method (identical to `calculatePercentile`).
 *
 * @param samples     Array of numeric values (need not be sorted)
 * @param percentiles Array of percentile values to compute (each 0–100)
 * @returns Map from percentile → value (empty map if samples is empty)
 */
export function calculatePercentiles(
	samples: number[],
	percentiles: number[],
): Map<number, number> {
	const result = new Map<number, number>();
	
	for (const p of percentiles) {
		if (p < 0 || p > 100) {
			throw new RangeError(`percentile must be 0–100, got ${p}`);
		}
	}
	
	if (samples.length === 0) {
		for (const p of percentiles) result.set(p, 0);
		return result;
	}

	const sorted = [...samples].sort((a, b) => a - b);

	for (const p of percentiles) {
		if (p === 0) {
			result.set(p, sorted[0] as number);
		} else if (p === 100) {
			result.set(p, sorted[sorted.length - 1] as number);
		} else {
			const rank = Math.ceil((p / 100) * sorted.length) - 1;
			result.set(p, sorted[Math.max(0, rank)] as number);
		}
	}

	return result;
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
