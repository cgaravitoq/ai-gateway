import { describe, expect, test } from "bun:test";
import { envSchema } from "@/config/env-schema.ts";

/**
 * Minimal valid env for testing — provides all required fields
 * with sensible defaults so each test only overrides what it needs.
 */
const validBase = {
	GATEWAY_API_KEY: "test-key-that-is-long-enough",
	OPENAI_API_KEY: "sk-test-openai-key",
};

describe("envSchema", () => {
	// ── GATEWAY_API_KEY ─────────────────────────────────────────

	describe("GATEWAY_API_KEY", () => {
		test("rejects keys shorter than 8 characters", () => {
			const result = envSchema.safeParse({ ...validBase, GATEWAY_API_KEY: "x" });
			expect(result.success).toBe(false);
		});

		test("rejects a 7-character key", () => {
			const result = envSchema.safeParse({ ...validBase, GATEWAY_API_KEY: "1234567" });
			expect(result.success).toBe(false);
		});

		test("accepts an 8-character key", () => {
			const result = envSchema.safeParse({ ...validBase, GATEWAY_API_KEY: "12345678" });
			expect(result.success).toBe(true);
		});

		test("rejects missing GATEWAY_API_KEY", () => {
			const { GATEWAY_API_KEY: _, ...noKey } = validBase;
			const result = envSchema.safeParse(noKey);
			expect(result.success).toBe(false);
		});
	});

	// ── ANTHROPIC_API_KEY (optional, empty-string normalization) ─

	describe("ANTHROPIC_API_KEY", () => {
		test("normalizes empty string to undefined", () => {
			const result = envSchema.safeParse({ ...validBase, ANTHROPIC_API_KEY: "" });
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.ANTHROPIC_API_KEY).toBeUndefined();
			}
		});

		test("normalizes whitespace-only string to undefined", () => {
			const result = envSchema.safeParse({ ...validBase, ANTHROPIC_API_KEY: "   " });
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.ANTHROPIC_API_KEY).toBeUndefined();
			}
		});

		test("keeps a valid key as-is", () => {
			const result = envSchema.safeParse({
				...validBase,
				ANTHROPIC_API_KEY: "sk-ant-test-key",
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");
			}
		});

		test("trims whitespace from a valid key", () => {
			const result = envSchema.safeParse({
				...validBase,
				ANTHROPIC_API_KEY: "  sk-ant-test-key  ",
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");
			}
		});

		test("allows omission (truly undefined)", () => {
			const result = envSchema.safeParse(validBase);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.ANTHROPIC_API_KEY).toBeUndefined();
			}
		});
	});

	// ── GOOGLE_API_KEY (optional, empty-string normalization) ────

	describe("GOOGLE_API_KEY", () => {
		test("normalizes empty string to undefined", () => {
			const result = envSchema.safeParse({ ...validBase, GOOGLE_API_KEY: "" });
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.GOOGLE_API_KEY).toBeUndefined();
			}
		});

		test("normalizes whitespace-only string to undefined", () => {
			const result = envSchema.safeParse({ ...validBase, GOOGLE_API_KEY: "  \t  " });
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.GOOGLE_API_KEY).toBeUndefined();
			}
		});

		test("keeps a valid key as-is", () => {
			const result = envSchema.safeParse({
				...validBase,
				GOOGLE_API_KEY: "AIza-test-google-key",
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.GOOGLE_API_KEY).toBe("AIza-test-google-key");
			}
		});

		test("trims whitespace from a valid key", () => {
			const result = envSchema.safeParse({
				...validBase,
				GOOGLE_API_KEY: "  AIza-test-google-key  ",
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.GOOGLE_API_KEY).toBe("AIza-test-google-key");
			}
		});
	});
});
