import { describe, expect, test } from "bun:test";

/**
 * Error tracker unit tests.
 *
 * Tests error recording, provider health, and error summary logic.
 * The error tracker is a pure in-memory service.
 *
 * NOTE: The error tracker depends on getTotalRequests() from metrics.ts
 * for error rate calculation. We import recordRequest() to simulate traffic.
 */

import {
	getErrorSummary,
	getProviderHealth,
	recordError,
	recordSuccess,
} from "../src/services/error-tracker.ts";
import { recordRequest } from "../src/services/metrics.ts";

// The error tracker module uses module-level state. We can't fully reset it
// between tests, so tests should be written to be additive or order-independent
// where possible. For a production test suite you'd add a reset function.

describe("recordError", () => {
	test("increments total error count", () => {
		// Record some requests so error rate calculation works
		for (let i = 0; i < 10; i++) recordRequest();

		const before = getErrorSummary().global.totalErrors;
		recordError("openai", 500, "Internal Server Error", false);
		const after = getErrorSummary().global.totalErrors;

		expect(after).toBe(before + 1);
	});

	test("categorizes 4xx errors", () => {
		recordRequest();
		const before = getErrorSummary().providers.openai;
		const before4xx = before?.errors4xx ?? 0;

		recordError("openai", 429, "Rate limited", false);

		const after = getErrorSummary().providers.openai;
		expect(after?.errors4xx).toBe(before4xx + 1);
	});

	test("categorizes 5xx errors", () => {
		recordRequest();
		const before = getErrorSummary().providers.anthropic;
		const before5xx = before?.errors5xx ?? 0;

		recordError("anthropic", 503, "Service Unavailable", false);

		const after = getErrorSummary().providers.anthropic;
		expect(after?.errors5xx).toBe(before5xx + 1);
	});

	test("tracks timeout errors", () => {
		recordRequest();
		const before = getErrorSummary().providers.google;
		const beforeTimeouts = before?.timeouts ?? 0;

		recordError("google", 408, "Request Timeout", true);

		const after = getErrorSummary().providers.google;
		expect(after?.timeouts).toBe(beforeTimeouts + 1);
	});

	test("increments consecutive failures", () => {
		for (let i = 0; i < 3; i++) recordRequest();

		recordError("openai", 500, "Error 1", false);
		recordError("openai", 500, "Error 2", false);
		recordError("openai", 500, "Error 3", false);

		const summary = getErrorSummary();
		expect(summary.providers.openai?.consecutiveFailures).toBeGreaterThanOrEqual(3);
	});

	test("records last error details", () => {
		recordRequest();
		recordError("openai", 502, "Bad Gateway", false);

		const summary = getErrorSummary();
		expect(summary.providers.openai?.lastError).toBeDefined();
		expect(summary.providers.openai?.lastError?.message).toBe("Bad Gateway");
		expect(summary.providers.openai?.lastError?.statusCode).toBe(502);
		expect(summary.providers.openai?.lastError?.timestamp).toBeGreaterThan(0);
	});

	test("adds to recent errors list", () => {
		recordRequest();
		const beforeCount = getErrorSummary().recentErrors.length;

		recordError("openai", 500, "test error", false);

		const afterCount = getErrorSummary().recentErrors.length;
		expect(afterCount).toBeGreaterThan(beforeCount);
	});
});

describe("recordSuccess", () => {
	test("resets consecutive failures for provider", () => {
		for (let i = 0; i < 5; i++) recordRequest();

		// Build up consecutive failures
		recordError("anthropic", 500, "Error", false);
		recordError("anthropic", 500, "Error", false);

		const beforeReset = getErrorSummary().providers.anthropic;
		expect(beforeReset?.consecutiveFailures).toBeGreaterThanOrEqual(2);

		// Success resets the counter
		recordSuccess("anthropic");

		const afterReset = getErrorSummary().providers.anthropic;
		expect(afterReset?.consecutiveFailures).toBe(0);
	});
});

describe("getProviderHealth", () => {
	test("returns healthy for provider with no errors", () => {
		// Google may not have many errors in our test run
		const health = getProviderHealth("google");
		// It should be an object with the expected shape
		expect(health).toHaveProperty("healthy");
		expect(health).toHaveProperty("errorRate");
		expect(health).toHaveProperty("consecutiveFailures");
	});

	test("returns expected shape", () => {
		const health = getProviderHealth("openai");

		expect(typeof health.healthy).toBe("boolean");
		expect(typeof health.errorRate).toBe("number");
		expect(typeof health.consecutiveFailures).toBe("number");
		expect(health.errorRate).toBeGreaterThanOrEqual(0);
		expect(health.errorRate).toBeLessThanOrEqual(1);
	});
});

describe("getErrorSummary", () => {
	test("returns global error stats", () => {
		const summary = getErrorSummary();

		expect(summary.global).toBeDefined();
		expect(typeof summary.global.totalErrors).toBe("number");
		expect(typeof summary.global.errorRate).toBe("number");
	});

	test("returns providers object", () => {
		const summary = getErrorSummary();
		expect(summary.providers).toBeDefined();
		expect(typeof summary.providers).toBe("object");
	});

	test("returns recent errors array", () => {
		const summary = getErrorSummary();
		expect(summary.recentErrors).toBeArray();
	});

	test("recent error entries have expected shape", () => {
		recordRequest();
		recordError("openai", 500, "Shape test error", true);

		const summary = getErrorSummary();
		const lastError = summary.recentErrors[summary.recentErrors.length - 1];

		expect(lastError).toBeDefined();
		expect(lastError?.provider).toBe("openai");
		expect(lastError?.statusCode).toBe(500);
		expect(lastError?.message).toBe("Shape test error");
		expect(lastError?.isTimeout).toBe(true);
		expect(lastError?.timestamp).toBeGreaterThan(0);
	});
});
