import { describe, expect, test } from "bun:test";
import { booleanEnv } from "./boolean-env";

describe("booleanEnv", () => {
	const parse = (value: string) => booleanEnv.parse(value);

	describe("falsy values → false", () => {
		const falsyInputs = ["false", "FALSE", "False", "0", "no", "off"];

		for (const input of falsyInputs) {
			test(`"${input}" → false`, () => {
				expect(parse(input)).toBe(false);
			});
		}
	});

	describe("falsy values with whitespace → false", () => {
		const paddedInputs = ["  false  ", " 0 ", "  no  ", "  off  "];

		for (const input of paddedInputs) {
			test(`"${input}" (trimmed) → false`, () => {
				expect(parse(input)).toBe(false);
			});
		}
	});

	describe("truthy values → true", () => {
		const truthyInputs = ["true", "TRUE", "1", "yes"];

		for (const input of truthyInputs) {
			test(`"${input}" → true`, () => {
				expect(parse(input)).toBe(true);
			});
		}
	});

	test("defaults to true when undefined", () => {
		expect(booleanEnv.parse(undefined)).toBe(true);
	});
});
