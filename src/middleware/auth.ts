import type { MiddlewareHandler } from "hono";
import { env } from "@/config/env.ts";
import { logger } from "@/middleware/logging.ts";

/**
 * API key authentication middleware.
 *
 * Expects an `Authorization: Bearer <key>` header whose value matches
 * the `GATEWAY_API_KEY` environment variable.
 *
 * On failure returns 401 in OpenAI-compatible error format.
 */
export function authMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		const authHeader = c.req.header("Authorization");

		if (!authHeader) {
			logger.warn({ path: c.req.path }, "Missing Authorization header");
			return c.json(
				{
					error: {
						message: "Missing Authorization header. Expected 'Bearer <api-key>'.",
						type: "authentication_error",
						code: 401,
					},
				},
				401,
			);
		}

		// Expect "Bearer <key>" format
		if (!authHeader.startsWith("Bearer ")) {
			logger.warn({ path: c.req.path }, "Malformed Authorization header");
			return c.json(
				{
					error: {
						message: "Malformed Authorization header. Expected 'Bearer <api-key>'.",
						type: "authentication_error",
						code: 401,
					},
				},
				401,
			);
		}

		const token = authHeader.slice("Bearer ".length);

		if (token !== env.GATEWAY_API_KEY) {
			logger.warn({ path: c.req.path }, "Invalid API key");
			return c.json(
				{
					error: {
						message: "Invalid API key.",
						type: "authentication_error",
						code: 401,
					},
				},
				401,
			);
		}

		await next();
	};
}
