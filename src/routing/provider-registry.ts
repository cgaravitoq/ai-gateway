import type { ProviderName } from "@/config/providers.ts";
import { latencyTracker } from "@/metrics/latency-tracker.ts";
import { logger } from "@/middleware/logging.ts";
import type { ProviderState } from "@/types/provider.ts";

/**
 * Circuit breaker thresholds.
 * After CIRCUIT_BREAKER_THRESHOLD consecutive errors a provider is marked
 * unavailable for CIRCUIT_BREAKER_COOLDOWN_MS before being re-evaluated.
 */
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

/** Internal runtime entry for a single provider */
interface ProviderEntry {
	id: ProviderName;
	consecutiveErrors: number;
	lastErrorAt: number | null;
	/** Timestamp when the circuit was opened (null when closed) */
	circuitOpenedAt: number | null;
	rateLimitRemaining: number;
	rateLimitResetAt: number;
}

/**
 * ProviderRegistry — tracks runtime health of every provider.
 *
 * Responsibilities:
 * - Record success / error outcomes
 * - Maintain a simple circuit breaker (consecutive-error based)
 * - Expose `ProviderState[]` for the routing engine
 */
export class ProviderRegistry {
	private readonly providers = new Map<ProviderName, ProviderEntry>();

	constructor(providerIds: ProviderName[]) {
		for (const id of providerIds) {
			this.providers.set(id, {
				id,
				consecutiveErrors: 0,
				lastErrorAt: null,
				circuitOpenedAt: null,
				rateLimitRemaining: Number.POSITIVE_INFINITY,
				rateLimitResetAt: 0,
			});
		}
	}

	// ── Queries ─────────────────────────────────────────────

	/** Build a snapshot of every provider's runtime state. */
	getProviderStates(): ProviderState[] {
		const now = Date.now();
		const states: ProviderState[] = [];

		for (const entry of this.providers.values()) {
			states.push({
				id: entry.id,
				available: this.isAvailableEntry(entry, now),
				rateLimitRemaining: this.effectiveRateLimit(entry, now),
				rateLimitResetAt: entry.rateLimitResetAt,
				latency: latencyTracker.getStats(entry.id),
				lastErrorAt: entry.lastErrorAt,
				consecutiveErrors: entry.consecutiveErrors,
			});
		}

		return states;
	}

	/** Whether the provider is currently available for routing. */
	isAvailable(provider: ProviderName): boolean {
		const entry = this.providers.get(provider);
		if (!entry) return false;
		return this.isAvailableEntry(entry, Date.now());
	}

	// ── Mutations ───────────────────────────────────────────

	/** Record a successful request — resets the circuit breaker. */
	reportSuccess(provider: ProviderName, modelId: string, latencyMs: number): void {
		const entry = this.providers.get(provider);
		if (!entry) return;

		entry.consecutiveErrors = 0;
		entry.circuitOpenedAt = null;

		latencyTracker.recordLatency(provider, modelId, latencyMs, latencyMs, true);

		logger.debug({ provider, modelId, latencyMs }, "provider success recorded");
	}

	/** Record a failed request — may trip the circuit breaker. */
	reportError(provider: ProviderName, modelId: string, error: unknown): void {
		const entry = this.providers.get(provider);
		if (!entry) return;

		const now = Date.now();
		entry.consecutiveErrors += 1;
		entry.lastErrorAt = now;

		latencyTracker.recordLatency(provider, modelId, 0, 0, false);

		// Trip the circuit breaker when the threshold is reached
		if (entry.consecutiveErrors >= CIRCUIT_BREAKER_THRESHOLD && entry.circuitOpenedAt === null) {
			entry.circuitOpenedAt = now;
			logger.warn(
				{ provider, consecutiveErrors: entry.consecutiveErrors },
				"circuit breaker opened — provider marked unavailable",
			);
		}

		logger.debug(
			{
				provider,
				consecutiveErrors: entry.consecutiveErrors,
				error: error instanceof Error ? error.message : String(error),
			},
			"provider error recorded",
		);
	}

	/** Update rate-limit counters (typically from provider response headers). */
	updateRateLimit(provider: ProviderName, remaining: number, resetAt: number): void {
		const entry = this.providers.get(provider);
		if (!entry) return;

		entry.rateLimitRemaining = remaining;
		entry.rateLimitResetAt = resetAt;
	}

	// ── Internals ───────────────────────────────────────────

	private isAvailableEntry(entry: ProviderEntry, now: number): boolean {
		// Circuit breaker check
		if (entry.circuitOpenedAt !== null) {
			const elapsed = now - entry.circuitOpenedAt;
			if (elapsed < CIRCUIT_BREAKER_COOLDOWN_MS) {
				return false;
			}
			// Cooldown expired — half-open: allow one attempt
			entry.circuitOpenedAt = null;
			entry.consecutiveErrors = 0;
			logger.info({ provider: entry.id }, "circuit breaker half-open — allowing retry");
		}
		return true;
	}

	private effectiveRateLimit(entry: ProviderEntry, now: number): number {
		// If the reset window has passed, treat as fully replenished
		if (entry.rateLimitResetAt > 0 && now >= entry.rateLimitResetAt) {
			return Number.POSITIVE_INFINITY;
		}
		return entry.rateLimitRemaining;
	}
}

// TODO: Replace hardcoded provider list with dynamic discovery from config/environment
/** Default singleton initialised with all known providers. */
export const providerRegistry = new ProviderRegistry(["openai", "anthropic", "google"]);
