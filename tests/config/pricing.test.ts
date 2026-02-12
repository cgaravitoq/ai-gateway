import { describe, expect, test } from "bun:test";
import { getModelPricing } from "@/config/pricing.ts";

describe("getModelPricing", () => {
	// ── Core models (from models.json) ─────────────────────────
	test("returns core pricing for gpt-4o", () => {
		const pricing = getModelPricing("gpt-4o");
		expect(pricing.modelId).toBe("gpt-4o");
		expect(pricing.provider).toBe("openai");
		expect(pricing.inputPer1k).toBe(0.0025);
		expect(pricing.outputPer1k).toBe(0.01);
	});

	test("returns core pricing for claude-sonnet-4-20250514", () => {
		const pricing = getModelPricing("claude-sonnet-4-20250514");
		expect(pricing.modelId).toBe("claude-sonnet-4-20250514");
		expect(pricing.provider).toBe("anthropic");
		expect(pricing.inputPer1k).toBe(0.003);
		expect(pricing.outputPer1k).toBe(0.015);
	});

	// ── Legacy models (NOT in models.json) ─────────────────────
	// These were previously unreachable due to the sentinel check bug.
	test("returns legacy pricing for gpt-3.5-turbo (not in models.json)", () => {
		const pricing = getModelPricing("gpt-3.5-turbo");
		expect(pricing.modelId).toBe("gpt-3.5-turbo");
		expect(pricing.provider).toBe("openai");
		expect(pricing.inputPer1k).toBe(0.0005);
		expect(pricing.outputPer1k).toBe(0.0015);
	});

	test("returns legacy pricing for claude-3.5-sonnet (not in models.json)", () => {
		const pricing = getModelPricing("claude-3.5-sonnet");
		expect(pricing.modelId).toBe("claude-3.5-sonnet");
		expect(pricing.provider).toBe("anthropic");
		expect(pricing.inputPer1k).toBe(0.003);
		expect(pricing.outputPer1k).toBe(0.015);
	});

	test("returns legacy pricing for claude-3-haiku (not in models.json)", () => {
		const pricing = getModelPricing("claude-3-haiku");
		expect(pricing.modelId).toBe("claude-3-haiku");
		expect(pricing.provider).toBe("anthropic");
		expect(pricing.inputPer1k).toBe(0.00025);
		expect(pricing.outputPer1k).toBe(0.00125);
	});

	test("returns legacy pricing for gemini-1.5-pro (not in models.json)", () => {
		const pricing = getModelPricing("gemini-1.5-pro");
		expect(pricing.modelId).toBe("gemini-1.5-pro");
		expect(pricing.provider).toBe("google");
		expect(pricing.inputPer1k).toBe(0.00125);
		expect(pricing.outputPer1k).toBe(0.005);
	});

	// ── Unknown models (not in core OR legacy) ─────────────────
	test("returns default fallback for completely unknown models", () => {
		const pricing = getModelPricing("totally-unknown-model");
		expect(pricing.modelId).toBe("totally-unknown-model");
		expect(pricing.provider).toBe("openai");
		// Default fallback values from models.ts DEFAULT_PRICING
		expect(pricing.inputPer1k).toBe(0.002);
		expect(pricing.outputPer1k).toBe(0.006);
	});

	// ── Regression: legacy prices differ from default fallback ──
	test("legacy gpt-3.5-turbo pricing differs from default fallback", () => {
		const legacy = getModelPricing("gpt-3.5-turbo");
		const fallback = getModelPricing("nonexistent-model-xyz");
		// The bug would have caused both to return the same default pricing
		expect(legacy.inputPer1k).not.toBe(fallback.inputPer1k);
		expect(legacy.outputPer1k).not.toBe(fallback.outputPer1k);
	});

	test("legacy claude-3.5-sonnet pricing differs from default fallback", () => {
		const legacy = getModelPricing("claude-3.5-sonnet");
		const fallback = getModelPricing("nonexistent-model-xyz");
		// outputPer1k happens to match (0.015 vs 0.006), but inputPer1k should differ
		expect(legacy.inputPer1k).not.toBe(fallback.inputPer1k);
	});
});
