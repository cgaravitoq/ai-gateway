import { Hono } from "hono";
import { cacheConfig } from "@/config/cache.ts";
import { isRedisHealthy } from "@/services/cache/redis.ts";
import { getMetrics } from "@/services/metrics.ts";

const health = new Hono();

health.get("/health", (c) => {
	return c.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	});
});

health.get("/ready", async (c) => {
	const redisOk = cacheConfig.enabled ? await isRedisHealthy() : true;

	const status = redisOk ? "ready" : "degraded";
	const statusCode = redisOk ? 200 : 503;

	return c.json(
		{
			status,
			checks: {
				server: "ok",
				redis: redisOk ? "ok" : "unavailable",
			},
		},
		statusCode,
	);
});

health.get("/metrics", (c) => {
	return c.json(getMetrics());
});

export { health };
