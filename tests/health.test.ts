import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

/**
 * Health endpoint tests.
 *
 * Creates a minimal Hono app that mirrors the health routes
 * to test response structure without starting the full server.
 */

function createHealthApp() {
	const app = new Hono();

	app.get("/health", (c) => {
		return c.json({
			status: "ok",
			timestamp: new Date().toISOString(),
			uptime: process.uptime(),
		});
	});

	app.get("/", (c) => {
		return c.json({
			name: "ai-gateway",
			version: "0.1.0",
			endpoints: ["/v1/chat/completions", "/health", "/ready", "/metrics", "/metrics/costs"],
		});
	});

	app.notFound((c) => {
		return c.json(
			{
				error: {
					message: "Not Found",
					type: "invalid_request_error",
					code: "not_found",
				},
			},
			404,
		);
	});

	return app;
}

describe("GET /health", () => {
	const app = createHealthApp();

	test("returns 200 with status ok", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.status).toBe("ok");
	});

	test("includes timestamp in ISO format", async () => {
		const res = await app.request("/health");
		const body = await res.json();

		expect(body.timestamp).toBeDefined();
		// Verify it's a valid ISO date string
		const parsed = new Date(body.timestamp);
		expect(parsed.toISOString()).toBe(body.timestamp);
	});

	test("includes uptime as a number", async () => {
		const res = await app.request("/health");
		const body = await res.json();

		expect(typeof body.uptime).toBe("number");
		expect(body.uptime).toBeGreaterThanOrEqual(0);
	});
});

describe("GET /", () => {
	const app = createHealthApp();

	test("returns gateway info", async () => {
		const res = await app.request("/");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.name).toBe("ai-gateway");
		expect(body.version).toBe("0.1.0");
		expect(body.endpoints).toBeArray();
		expect(body.endpoints).toContain("/v1/chat/completions");
		expect(body.endpoints).toContain("/health");
	});
});

describe("404 handler", () => {
	const app = createHealthApp();

	test("returns 404 for unknown routes", async () => {
		const res = await app.request("/unknown-route");
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBeDefined();
		expect(body.error.message).toBe("Not Found");
		expect(body.error.type).toBe("invalid_request_error");
		expect(body.error.code).toBe("not_found");
	});
});
