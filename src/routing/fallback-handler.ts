import { APICallError } from "ai";
import type { ProviderName } from "@/config/providers.ts";
import { logger } from "@/middleware/logging.ts";
import { errorTracker } from "@/services/error-tracker.ts";
import type { FallbackConfig, FallbackResult, RetryAttempt } from "@/types/fallback.ts";
import {
	BASE_BACKOFF_MS,
	calculateBackoff,
	isRetryableError,
	MAX_BACKOFF_MS,
	MAX_RETRIES,
	sleep,
} from "./retry-strategy.ts";

/** Default total timeout for the entire fallback chain (ms) */
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;

/** Default fallback configuration */
const DEFAULT_CONFIG: FallbackConfig = {
	maxRetries: MAX_RETRIES,
	baseBackoffMs: BASE_BACKOFF_MS,
	maxBackoffMs: MAX_BACKOFF_MS,
	totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS,
};

/** Options for a single executeWithFallback invocation */
export interface ExecuteOptions {
	/**
	 * When `true`, per-provider retries are disabled — only provider failover
	 * is performed. This prevents duplicate stream starts when the caller is
	 * consuming an SSE / streaming response.
	 */
	streaming?: boolean;
}

/**
 * Error thrown when the overall `totalTimeoutMs` deadline is exceeded before
 * any provider returns a successful response.
 */
export class FallbackTimeoutError extends Error {
	public readonly attempts: RetryAttempt[];
	public readonly statusCode = 504;

	constructor(totalTimeoutMs: number, attempts: RetryAttempt[]) {
		super(
			`Fallback chain timed out after ${totalTimeoutMs}ms. ` +
				`${attempts.length} attempt(s) were made before the deadline.`,
		);
		this.name = "FallbackTimeoutError";
		this.attempts = attempts;
	}
}

/**
 * Aggregated error thrown when every provider in the fallback chain has been
 * exhausted. Carries the full attempt log so callers can inspect individual
 * failures.
 */
export class AllProvidersFailedError extends Error {
	public readonly attempts: RetryAttempt[];
	public readonly statusCode = 503;

	constructor(attempts: RetryAttempt[]) {
		const providersSummary = [...new Set(attempts.map((a) => a.provider))].join(", ");

		super(
			`All providers exhausted. Tried: [${providersSummary}] ` +
				`across ${attempts.length} attempt(s). ` +
				`Last error: ${attempts[attempts.length - 1]?.error?.message ?? "unknown"}`,
		);

		this.name = "AllProvidersFailedError";
		this.attempts = attempts;
	}
}

/**
 * FallbackHandler orchestrates retries within a single provider and failover
 * across an ordered list of providers.
 *
 * Flow per provider:
 *   1. Call `executeFn(provider, signal)`
 *   2. On retryable error → abort previous request, backoff & retry up to `maxRetries`
 *   3. On non-retryable error or retries exhausted → move to next provider
 *   4. If every provider fails → throw `AllProvidersFailedError` (HTTP 503)
 *   5. If `totalTimeoutMs` elapses → throw `FallbackTimeoutError` (HTTP 504)
 *
 * When `streaming: true`, per-provider retries are disabled to avoid duplicate
 * stream starts — only provider-level failover is performed.
 */
export class FallbackHandler {
	private readonly config: FallbackConfig;

	constructor(config?: Partial<FallbackConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Execute an operation with automatic retry and provider fallback.
	 *
	 * @param providers  Ordered provider list (first = preferred)
	 * @param executeFn  Async function that performs the work for a given provider.
	 *                   Receives an `AbortSignal` — callers MUST pass it through
	 *                   to the underlying HTTP/fetch call.
	 * @param options    Optional execution flags (e.g. `streaming`)
	 * @returns          The successful result wrapped with attempt metadata
	 */
	async executeWithFallback<T>(
		providers: string[],
		executeFn: (provider: string, signal: AbortSignal) => Promise<T>,
		options?: ExecuteOptions,
	): Promise<FallbackResult<T>> {
		const attempts: RetryAttempt[] = [];

		// --- Overall timeout (Issue #2) ---
		const overallController = new AbortController();
		const timeoutMs = this.config.totalTimeoutMs;
		const timer = setTimeout(() => overallController.abort(), timeoutMs);

		try {
			for (const provider of providers) {
				// Bail out early if the overall deadline already fired
				if (overallController.signal.aborted) {
					break;
				}

				const result = await this.tryProvider<T>(
					provider,
					executeFn,
					attempts,
					overallController.signal,
					options,
				);

				if (result !== undefined) {
					return {
						result,
						attemptsUsed: attempts.length,
						providersTriedCount: new Set(attempts.map((a) => a.provider)).size,
						attempts,
					};
				}
			}
		} finally {
			clearTimeout(timer);
		}

		// If we broke out because of the overall timeout, throw a specific error
		if (overallController.signal.aborted) {
			logger.error({
				type: "fallback_timeout",
				totalTimeoutMs: timeoutMs,
				totalAttempts: attempts.length,
			});

			throw new FallbackTimeoutError(timeoutMs, attempts);
		}

		// Every provider in the chain has failed
		logger.error({
			type: "fallback_exhausted",
			providers,
			totalAttempts: attempts.length,
			errors: attempts.map((a) => ({
				provider: a.provider,
				error: a.error?.message,
				latencyMs: a.latencyMs,
			})),
		});

		throw new AllProvidersFailedError(attempts);
	}

	/**
	 * Try a single provider with retries. Returns `undefined` when all retries
	 * for this provider are exhausted (signalling the caller to fall back).
	 */
	private async tryProvider<T>(
		provider: string,
		executeFn: (provider: string, signal: AbortSignal) => Promise<T>,
		attempts: RetryAttempt[],
		overallSignal: AbortSignal,
		options?: ExecuteOptions,
	): Promise<T | undefined> {
		// Streaming disables per-provider retries (Issue #3)
		const maxAttempts = options?.streaming ? 1 : this.config.maxRetries + 1;

		// Track the current per-attempt controller so we can abort in-flight
		// requests when retrying (Issue #1)
		let attemptController: AbortController | null = null;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			// Abort previous in-flight request before starting a new attempt
			if (attemptController) {
				attemptController.abort();
			}

			// Create a fresh AbortController for this attempt. It should fire
			// when *either* the overall deadline expires or we explicitly abort.
			attemptController = new AbortController();
			const currentController = attemptController;

			// Link the overall signal to this attempt's controller
			const onOverallAbort = () => currentController.abort();
			overallSignal.addEventListener("abort", onOverallAbort, { once: true });

			// Bail out if the overall deadline already fired
			if (overallSignal.aborted) {
				overallSignal.removeEventListener("abort", onOverallAbort);
				return undefined;
			}

			const start = Date.now();

			try {
				const result = await executeFn(provider, currentController.signal);

				// Record successful attempt
				attempts.push({
					provider,
					error: null,
					latencyMs: Date.now() - start,
					timestamp: start,
				});

				logger.info({
					type: "fallback_success",
					provider,
					attempt: attempt + 1,
					latencyMs: Date.now() - start,
				});

				return result;
			} catch (err) {
				const latencyMs = Date.now() - start;

				// Preserve the original error type (Issue #5).
				// APICallError and other Error subclasses keep their properties.
				const error = err instanceof Error ? err : new Error(String(err));

				attempts.push({
					provider,
					error,
					latencyMs,
					timestamp: start,
				});

				// Record the failure in the error tracker so it feeds into
				// health checks, alerting, and the /metrics endpoint.
				const statusCode = err instanceof APICallError ? (err.statusCode ?? 500) : 500;
				const isTimeout = overallSignal.aborted || error.name === "TimeoutError";
				errorTracker.recordError(
					provider as ProviderName | "unknown",
					statusCode,
					error.message,
					isTimeout,
				);

				// If the overall timeout fired, stop immediately
				if (overallSignal.aborted) {
					return undefined;
				}

				const retryable = isRetryableError(err);
				const hasRetriesLeft = attempt < maxAttempts - 1;

				if (retryable && hasRetriesLeft) {
					const backoff = calculateBackoff(
						attempt,
						this.config.baseBackoffMs,
						this.config.maxBackoffMs,
					);

					logger.warn({
						type: "fallback_retry",
						provider,
						attempt: attempt + 1,
						maxRetries: this.config.maxRetries,
						backoffMs: backoff,
						error: error.message,
					});

					await sleep(backoff);
					continue;
				}

				// Non-retryable or retries exhausted → fall back to next provider
				logger.warn({
					type: retryable ? "fallback_retries_exhausted" : "fallback_non_retryable",
					provider,
					attempt: attempt + 1,
					error: error.message,
					movingToNextProvider: true,
				});

				return undefined;
			} finally {
				overallSignal.removeEventListener("abort", onOverallAbort);
			}
		}

		return undefined;
	}
}
