import { Hono } from "hono";
import { errorHandler } from "@/middleware/error-handler.ts";
import { logger, requestLogger } from "@/middleware/logging.ts";
import { chat } from "@/routes/chat.ts";
import { health } from "@/routes/health.ts";

const app = new Hono();

// Global middleware
app.use(requestLogger());

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
		endpoints: ["/v1/chat/completions", "/health", "/ready"],
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

const port = Number.parseInt(process.env.PORT || "3000", 10);

export default {
	port,
	fetch: app.fetch,
};

logger.info({ port }, `AI Gateway running on http://localhost:${port}`);
