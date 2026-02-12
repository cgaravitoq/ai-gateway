import { z } from "zod/v4";

/** Falsy string values — case-insensitive, trimmed. */
export const FALSY_VALUES = ["false", "0", "no", "off"] as const;

/** Zod string-to-boolean transform: coerces common falsy env values to `false`. */
export const booleanEnv = z
	.string()
	.default("true")
	.transform(
		(v) => !FALSY_VALUES.includes(v.toLowerCase().trim() as (typeof FALSY_VALUES)[number]),
	);
