import { describe, expect, test } from "bun:test";
import { envSchema } from "../src/config/env-schema.ts";

/** Minimal valid env vars — only the required fields that have no defaults */
const REQUIRED_ENV = {
	GATEWAY_API_KEY: "test-gateway-key",
	OPENAI_API_KEY: "test-openai-key",
};

describe("envSchema timeout cross-validation", () => {
	test("defaults pass — ROUTING_TIMEOUT_MS (60s) >= TIMEOUT_ANTHROPIC_MS (60s)", () => {
		const result = envSchema.safeParse(REQUIRED_ENV);
		expect(result.success).toBe(true);
	});

	test("rejects ROUTING_TIMEOUT_MS lower than a per-provider timeout", () => {
		const result = envSchema.safeParse({
			...REQUIRED_ENV,
			ROUTING_TIMEOUT_MS: "30000", // 30s — lower than Anthropic's 60s default
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const messages = result.error.issues.map((i) => i.message);
			expect(messages.some((m) => m.includes("ROUTING_TIMEOUT_MS"))).toBe(true);
			expect(messages.some((m) => m.includes("60000"))).toBe(true);
		}
	});

	test("accepts ROUTING_TIMEOUT_MS equal to the highest provider timeout", () => {
		const result = envSchema.safeParse({
			...REQUIRED_ENV,
			ROUTING_TIMEOUT_MS: "60000",
			TIMEOUT_OPENAI_MS: "30000",
			TIMEOUT_ANTHROPIC_MS: "60000",
			TIMEOUT_GOOGLE_MS: "30000",
		});
		expect(result.success).toBe(true);
	});

	test("accepts ROUTING_TIMEOUT_MS greater than the highest provider timeout", () => {
		const result = envSchema.safeParse({
			...REQUIRED_ENV,
			ROUTING_TIMEOUT_MS: "120000",
			TIMEOUT_ANTHROPIC_MS: "90000",
		});
		expect(result.success).toBe(true);
	});

	test("rejects when custom provider timeout exceeds global timeout", () => {
		const result = envSchema.safeParse({
			...REQUIRED_ENV,
			ROUTING_TIMEOUT_MS: "45000",
			TIMEOUT_OPENAI_MS: "30000",
			TIMEOUT_ANTHROPIC_MS: "60000", // 60s > 45s global
			TIMEOUT_GOOGLE_MS: "30000",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const messages = result.error.issues.map((i) => i.message);
			expect(messages.some((m) => m.includes("45000"))).toBe(true);
			expect(messages.some((m) => m.includes("60000"))).toBe(true);
		}
	});

	test("error message explains the silent failure risk", () => {
		const result = envSchema.safeParse({
			...REQUIRED_ENV,
			ROUTING_TIMEOUT_MS: "10000",
			TIMEOUT_ANTHROPIC_MS: "60000",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const msg = result.error.issues.map((i) => i.message).join(" ");
			expect(msg).toInclude("silently kills requests");
		}
	});
});
