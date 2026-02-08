import { Hono } from "hono";

const health = new Hono();

health.get("/health", (c) => {
	return c.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	});
});

health.get("/ready", (c) => {
	// TODO: Add Redis connectivity check in Phase 2
	return c.json({
		status: "ready",
		checks: {
			server: "ok",
		},
	});
});

export { health };
