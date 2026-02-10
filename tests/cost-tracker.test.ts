import { afterEach, describe, expect, test } from "bun:test";

/**
 * Cost tracker unit tests.
 *
 * Tests the cost calculation logic directly without any external dependencies.
 * The cost tracker is a pure in-memory service.
 */

import { getModelPricing } from "../src/config/pricing.ts";
// Import the actual cost tracker and pricing functions
import {
	getCostSummary,
	getTotalCost,
	recordCost,
	resetCostTracking,
} from "../src/services/cost-tracker.ts";

afterEach(() => {
	resetCostTracking();
});

describe("getModelPricing", () => {
	test("returns pricing for known models", () => {
		const gpt4o = getModelPricing("gpt-4o");
		expect(gpt4o.provider).toBe("openai");
		expect(gpt4o.inputPer1k).toBeGreaterThan(0);
		expect(gpt4o.outputPer1k).toBeGreaterThan(0);
	});

	test("returns fallback pricing for unknown models", () => {
		const unknown = getModelPricing("some-unknown-model-xyz");
		expect(unknown.modelId).toBe("some-unknown-model-xyz");
		expect(unknown.inputPer1k).toBeGreaterThan(0);
		expect(unknown.outputPer1k).toBeGreaterThan(0);
	});

	test("returns correct pricing for each provider", () => {
		const openai = getModelPricing("gpt-4o-mini");
		expect(openai.provider).toBe("openai");

		const anthropic = getModelPricing("claude-sonnet-4-20250514");
		expect(anthropic.provider).toBe("anthropic");

		const google = getModelPricing("gemini-2.0-flash");
		expect(google.provider).toBe("google");
	});
});

describe("recordCost", () => {
	test("calculates cost based on token usage", () => {
		const pricing = getModelPricing("gpt-4o");
		const result = recordCost("openai", "gpt-4o", 1000, 500);

		// Cost = (inputTokens / 1000) * inputPer1k + (outputTokens / 1000) * outputPer1k
		const expectedCost = (1000 / 1000) * pricing.inputPer1k + (500 / 1000) * pricing.outputPer1k;
		expect(result.costUsd).toBeCloseTo(expectedCost, 6);
	});

	test("records provider and model info", () => {
		const result = recordCost("openai", "gpt-4o", 100, 50);

		expect(result.provider).toBe("openai");
		expect(result.modelId).toBe("gpt-4o");
		expect(result.inputTokens).toBe(100);
		expect(result.outputTokens).toBe(50);
		expect(result.timestamp).toBeGreaterThan(0);
	});

	test("returns zero cost for zero tokens", () => {
		const result = recordCost("openai", "gpt-4o", 0, 0);
		expect(result.costUsd).toBe(0);
	});

	test("accumulates total cost across requests", () => {
		recordCost("openai", "gpt-4o", 1000, 500);
		recordCost("anthropic", "claude-sonnet-4-20250514", 1000, 500);

		const total = getTotalCost();
		expect(total).toBeGreaterThan(0);
	});
});

describe("getCostSummary", () => {
	test("returns empty summary when no requests recorded", () => {
		const summary = getCostSummary();

		expect(summary.totalCostUsd).toBe(0);
		expect(summary.totalInputTokens).toBe(0);
		expect(summary.totalOutputTokens).toBe(0);
		expect(summary.recentRequests).toHaveLength(0);
	});

	test("tracks per-provider breakdown", () => {
		recordCost("openai", "gpt-4o", 100, 50);
		recordCost("openai", "gpt-4o", 200, 100);
		recordCost("anthropic", "claude-sonnet-4-20250514", 150, 75);

		const summary = getCostSummary();

		expect(summary.byProvider.openai.requests).toBe(2);
		expect(summary.byProvider.anthropic.requests).toBe(1);
		expect(summary.byProvider.google.requests).toBe(0);

		expect(summary.byProvider.openai.inputTokens).toBe(300);
		expect(summary.byProvider.openai.outputTokens).toBe(150);
	});

	test("tracks per-model breakdown", () => {
		recordCost("openai", "gpt-4o", 100, 50);
		recordCost("openai", "gpt-4o-mini", 200, 100);
		recordCost("openai", "gpt-4o", 100, 50);

		const summary = getCostSummary();

		expect(summary.byModel["gpt-4o"]?.requests).toBe(2);
		expect(summary.byModel["gpt-4o-mini"]?.requests).toBe(1);
	});

	test("maintains recent requests list", () => {
		recordCost("openai", "gpt-4o", 100, 50);
		recordCost("anthropic", "claude-sonnet-4-20250514", 200, 100);

		const summary = getCostSummary();
		expect(summary.recentRequests).toHaveLength(2);
		expect(summary.recentRequests[0]?.provider).toBe("openai");
		expect(summary.recentRequests[1]?.provider).toBe("anthropic");
	});

	test("total tokens match sum of per-request tokens", () => {
		recordCost("openai", "gpt-4o", 100, 50);
		recordCost("anthropic", "claude-sonnet-4-20250514", 200, 100);
		recordCost("google", "gemini-2.0-flash", 300, 150);

		const summary = getCostSummary();
		expect(summary.totalInputTokens).toBe(600);
		expect(summary.totalOutputTokens).toBe(300);
	});
});

describe("resetCostTracking", () => {
	test("resets all counters to zero", () => {
		recordCost("openai", "gpt-4o", 1000, 500);
		recordCost("anthropic", "claude-sonnet-4-20250514", 500, 250);

		expect(getTotalCost()).toBeGreaterThan(0);

		resetCostTracking();

		expect(getTotalCost()).toBe(0);
		const summary = getCostSummary();
		expect(summary.totalCostUsd).toBe(0);
		expect(summary.totalInputTokens).toBe(0);
		expect(summary.recentRequests).toHaveLength(0);
		expect(summary.byProvider.openai.requests).toBe(0);
		expect(summary.byProvider.anthropic.requests).toBe(0);
	});
});
