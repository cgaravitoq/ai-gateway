import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cacheConfig } from "@/config/cache.ts";
import { env } from "@/config/env.ts";
import { authMiddleware } from "@/middleware/auth.ts";
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
import { connectRedis, disconnectRedis } from "@/services/cache/redis.ts";
import { initTelemetry, shutdownTelemetry } from "@/telemetry/setup.ts";
import packageJson from "../package.json";

// Initialize OpenTelemetry BEFORE creating the app so spans are captured from the start
initTelemetry();

const app = new Hono();

// Drain middleware — reject new requests during shutdown (must be first)
let isShuttingDown = false;
app.use("*", async (c, next) => {
	if (isShuttingDown)
		return c.json(
			{
				error: {
					message: "Service shutting down",
					type: "server_error",
					code: 503,
				},
			},
			503,
		);
	await next();
});

// Global middleware — tracing first so every request gets a root span
app.use(tracingMiddleware());
app.use(requestLogger());

// Middleware chain: auth → rate limiter → timeout → smart router → semantic cache
app.use("/v1/*", authMiddleware());
app.use(
	"/v1/*",
	bodyLimit({
		maxSize: 1024 * 1024, // 1MB
		onError: (c) => {
			return c.json(
				{
					error: {
						message: "Request body too large. Maximum size is 1MB.",
						type: "invalid_request_error",
						code: 413,
					},
				},
				413,
			);
		},
	}),
);
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
		version: packageJson.version,
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
				path: c.req.path,
			},
		},
		404,
	);
});

const port = env.PORT;

const server = Bun.serve({
	port,
	fetch: app.fetch,
});

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

// ── Graceful Shutdown ────────────────────────────────────────
// Handles SIGTERM (Kubernetes) and SIGINT (Ctrl+C) for clean teardown.
// 1. Stop accepting new connections
// 2. Wait for in-flight requests to drain (with timeout)
// 3. Close Redis connections
// 4. Flush OpenTelemetry spans
// 5. Exit

/** Maximum time to wait for in-flight requests before force-exiting */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const shutdown = async (signal: string) => {
	if (isShuttingDown) return;
	isShuttingDown = true;
	server.stop();

	logger.info({ signal }, "Graceful shutdown initiated");

	// Set a hard deadline — force exit if cleanup takes too long
	const forceExit = setTimeout(() => {
		logger.error("Shutdown timeout exceeded — forcing exit");
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS);

	try {
		// Wait briefly for in-flight requests to complete
		// Bun's server will stop accepting new connections after this tick,
		// but existing connections continue until they respond.
		await new Promise((resolve) => setTimeout(resolve, 2_000));

		// Close Redis connection
		logger.info("Closing Redis connection...");
		await disconnectRedis().catch((err) => {
			logger.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"Error closing Redis connection",
			);
		});

		// Flush pending OTel spans
		logger.info("Flushing telemetry...");
		await shutdownTelemetry().catch((err) => {
			logger.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"Error flushing telemetry",
			);
		});

		logger.info("Shutdown complete");
		clearTimeout(forceExit);
		process.exit(0);
	} catch (err) {
		logger.error(
			{ err: err instanceof Error ? err.message : String(err) },
			"Error during shutdown",
		);
		clearTimeout(forceExit);
		process.exit(1);
	}
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

logger.info({ port }, `AI Gateway running on http://localhost:${port}`);
