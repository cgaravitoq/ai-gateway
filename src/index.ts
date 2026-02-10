import { Hono } from "hono";
import { cacheConfig } from "@/config/cache.ts";
import { env } from "@/config/env.ts";
import { semanticCacheMiddleware } from "@/middleware/cache.ts";
import { errorHandler } from "@/middleware/error-handler.ts";
import { logger, requestLogger } from "@/middleware/logging.ts";
import { rateLimiter } from "@/middleware/rate-limiter.ts";
import { smartRouter } from "@/middleware/smart-router.ts";
import { timeoutMiddleware } from "@/middleware/timeout.ts";
import { tracingMiddleware } from "@/middleware/tracing.ts";
import { chat } from "@/routes/chat.ts";
import { health } from "@/routes/health.ts";
import { ensureVectorIndex } from "@/services/cache/index-setup.ts";
import { connectRedis } from "@/services/cache/redis.ts";
import { initTelemetry, shutdownTelemetry } from "@/telemetry/setup.ts";

// Initialize OpenTelemetry BEFORE creating the app so spans are captured from the start
initTelemetry();

const app = new Hono();

// Global middleware — tracing first so every request gets a root span
app.use(tracingMiddleware());
app.use(requestLogger());

// Middleware chain: rate limiter → timeout → smart router → semantic cache
app.use("/v1/*", rateLimiter());
app.use("/v1/*", timeoutMiddleware(30_000));
app.use("/v1/*", smartRouter());
app.use("/v1/*", semanticCacheMiddleware());

// Global error handler
app.onError(errorHandler);

// Mount routes
app.route("/", health);
app.route("/", chat);

// Root endpoint
app.get("/", (c) => {
	return c.json({
		name: "ai-gateway",
		version: "0.1.0",
		endpoints: ["/v1/chat/completions", "/health", "/ready", "/metrics", "/metrics/costs"],
	});
});

// 404 handler
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

const port = env.PORT;

export default {
	port,
	fetch: app.fetch,
};

// Initialize Redis and vector index (non-blocking — gateway starts even if Redis is down)
if (cacheConfig.enabled) {
	connectRedis()
		.then(() => ensureVectorIndex())
		.then(() => logger.info("Semantic cache initialized"))
		.catch((err) => {
			logger.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"Semantic cache unavailable — running without cache",
			);
		});
}

// Graceful shutdown — flush pending spans before exiting
const shutdown = async () => {
	logger.info("Shutting down — flushing telemetry...");
	await shutdownTelemetry();
	process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

logger.info({ port }, `AI Gateway running on http://localhost:${port}`);
