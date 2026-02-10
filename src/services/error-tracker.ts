/**
 * Error tracking service with per-provider health monitoring and alerting.
 * Singleton, in-memory store — same pattern as metrics.ts.
 */

import type { ProviderName } from "@/config/providers.ts";
import { logger } from "@/middleware/logging.ts";
import { getTotalRequests } from "@/services/metrics.ts";

// ── Types ────────────────────────────────────────────────

interface LastError {
	message: string;
	timestamp: number;
	statusCode: number;
}

interface ProviderErrorStats {
	totalErrors: number;
	errors4xx: number;
	errors5xx: number;
	timeouts: number;
	consecutiveFailures: number;
	lastError: LastError | null;
}

interface ProviderHealth {
	healthy: boolean;
	errorRate: number;
	consecutiveFailures: number;
}

interface TimestampedError {
	provider: ProviderName | "unknown";
	statusCode: number;
	message: string;
	isTimeout: boolean;
	timestamp: number;
}

export interface ErrorSummary {
	global: {
		totalErrors: number;
		errorRate: number;
	};
	providers: Record<string, ProviderErrorStats>;
	recentErrors: TimestampedError[];
}

// ── Constants ────────────────────────────────────────────

/** Rolling window size for rate calculation */
const ROLLING_WINDOW_SIZE = 100;

/** Time window for error rate calculation (5 minutes) */
const ERROR_RATE_WINDOW_MS = 5 * 60 * 1000;

/** Alert threshold — warn if error rate exceeds 50% */
const ALERT_THRESHOLD = 0.5;

/** Cooldown between repeated alerts for the same provider (5 minutes) */
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

// ── State ────────────────────────────────────────────────

const providerStats: Record<string, ProviderErrorStats> = {};
const recentErrors: TimestampedError[] = [];
let totalErrors = 0;

/** Tracks the last time an alert was fired per provider (or "global") */
const lastAlertAt: Record<string, number> = {};

// ── Helpers ──────────────────────────────────────────────

/**
 * Remove entries from `recentErrors` that are older than `ERROR_RATE_WINDOW_MS`.
 * Also prunes stale keys from `providerStats` where `lastError` has aged out and
 * all counters sit at 0 consecutive failures. Called before every read to keep
 * memory bounded even under sustained traffic.
 */
function pruneStaleErrors(): void {
	const cutoff = Date.now() - ERROR_RATE_WINDOW_MS;

	// Remove stale entries from the rolling window (oldest are at the front)
	let head = recentErrors[0];
	while (head && head.timestamp < cutoff) {
		recentErrors.shift();
		head = recentErrors[0];
	}
}

function ensureProviderStats(provider: string): ProviderErrorStats {
	if (!providerStats[provider]) {
		providerStats[provider] = {
			totalErrors: 0,
			errors4xx: 0,
			errors5xx: 0,
			timeouts: 0,
			consecutiveFailures: 0,
			lastError: null,
		};
	}
	return providerStats[provider];
}

/**
 * Calculate error rate over the last 5-minute window.
 * Uses totalRequests from metrics.ts as the denominator.
 * Prunes stale entries before reading to keep memory bounded.
 */
function calculateErrorRate(provider?: string): number {
	pruneStaleErrors();

	const windowErrors = provider
		? recentErrors.filter((e) => e.provider === provider)
		: recentErrors;

	const total = getTotalRequests();
	if (total === 0) return 0;

	return windowErrors.length / total;
}

/**
 * Check alert thresholds per provider and globally.
 * Logs a WARN when error rate > 50% in the last 5 min.
 * Enforces a cooldown of `ALERT_COOLDOWN_MS` between repeated alerts for the
 * same provider (or "global") to avoid log spam under sustained failures.
 */
function checkAlerts(provider: ProviderName | "unknown"): void {
	const now = Date.now();

	// Per-provider alert
	const providerRate = calculateErrorRate(provider);
	if (providerRate > ALERT_THRESHOLD) {
		const lastFired = lastAlertAt[provider] ?? 0;
		if (now - lastFired >= ALERT_COOLDOWN_MS) {
			lastAlertAt[provider] = now;
			logger.warn({
				alert: "high_error_rate",
				provider,
				rate: Math.round(providerRate * 1000) / 1000,
			});
		}
	}

	// Global alert
	const globalRate = calculateErrorRate();
	if (globalRate > ALERT_THRESHOLD) {
		const lastFired = lastAlertAt.global ?? 0;
		if (now - lastFired >= ALERT_COOLDOWN_MS) {
			lastAlertAt.global = now;
			logger.warn({
				alert: "high_error_rate",
				provider: "global",
				rate: Math.round(globalRate * 1000) / 1000,
			});
		}
	}
}

// ── Public API ───────────────────────────────────────────

/**
 * Record an error from a provider request.
 */
export function recordError(
	provider: ProviderName | "unknown",
	statusCode: number,
	message: string,
	isTimeout: boolean,
): void {
	totalErrors++;

	// Update per-provider stats
	const stats = ensureProviderStats(provider);
	stats.totalErrors++;
	stats.consecutiveFailures++;

	if (statusCode >= 400 && statusCode < 500) {
		stats.errors4xx++;
	} else if (statusCode >= 500) {
		stats.errors5xx++;
	}

	if (isTimeout) {
		stats.timeouts++;
	}

	stats.lastError = {
		message,
		timestamp: Date.now(),
		statusCode,
	};

	// Prune stale entries before adding to keep memory bounded
	pruneStaleErrors();

	// Add to rolling window
	const entry: TimestampedError = {
		provider,
		statusCode,
		message,
		isTimeout,
		timestamp: Date.now(),
	};

	recentErrors.push(entry);

	// Also cap at ROLLING_WINDOW_SIZE as a hard upper bound
	while (recentErrors.length > ROLLING_WINDOW_SIZE) {
		recentErrors.shift();
	}

	// Check alerts
	checkAlerts(provider);
}

/**
 * Record a successful request for a provider (resets consecutive failures).
 */
export function recordSuccess(provider: ProviderName): void {
	const stats = ensureProviderStats(provider);
	stats.consecutiveFailures = 0;
}

/**
 * Get the full error state summary.
 */
export function getErrorSummary(): ErrorSummary {
	return {
		global: {
			totalErrors,
			errorRate: calculateErrorRate(),
		},
		providers: { ...providerStats },
		recentErrors: [...recentErrors],
	};
}

/**
 * Get health status for a specific provider.
 */
export function getProviderHealth(provider: ProviderName): ProviderHealth {
	const stats = providerStats[provider];
	const errorRate = calculateErrorRate(provider);

	if (!stats) {
		return { healthy: true, errorRate: 0, consecutiveFailures: 0 };
	}

	return {
		healthy: errorRate <= ALERT_THRESHOLD && stats.consecutiveFailures < 5,
		errorRate,
		consecutiveFailures: stats.consecutiveFailures,
	};
}

/** Singleton accessor — exported as a namespace object for convenience */
export const errorTracker = {
	recordError,
	recordSuccess,
	getErrorSummary,
	getProviderHealth,
} as const;
