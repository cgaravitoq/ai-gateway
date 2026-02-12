import type { z } from "zod/v4";
import { envSchema } from "@/config/env-schema.ts";

export { envSchema } from "@/config/env-schema.ts";

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
	const result = envSchema.safeParse(process.env);

	if (!result.success) {
		console.error("Invalid environment variables:");
		console.error(JSON.stringify(result.error.format(), null, 2));
		process.exit(1);
	}

	return result.data;
}

/** Validated environment variables — import this instead of using process.env */
export const env = loadEnv();
