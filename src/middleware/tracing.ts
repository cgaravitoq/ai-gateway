import { context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";
import { getTracer } from "@/telemetry/setup.ts";

/**
 * Hono environment variables for tracing middleware.
 *
 * Downstream middleware / handlers can access the root span via
 * `c.get("rootSpan")` to create child spans.
 */
export interface TracingEnv {
	Variables: {
		/** Root request span — child spans should use this as parent context */
		rootSpan: Span;
	};
}

/**
 * OpenTelemetry tracing middleware for Hono.
 *
 * Creates a root span `gateway.request` for each incoming request and
 * propagates the trace context so downstream middleware can create child spans.
 *
 * Span attributes:
 * - http.method, http.url, http.status_code, request_id
 *
 * The active span is stored in both:
 * 1. Hono context (`c.set("rootSpan", span)`) — for sibling middleware
 * 2. OTel context (`context.with(...)`) — for native OTel propagation
 */
export function tracingMiddleware(): MiddlewareHandler<TracingEnv> {
	return async (c, next) => {
		const tracer = getTracer();
		const requestId =
			c.res.headers.get("x-request-id") ?? c.req.header("x-request-id") ?? "unknown";

		const span = tracer.startSpan("gateway.request", {
			attributes: {
				"http.method": c.req.method,
				"http.url": c.req.url,
				request_id: requestId,
			},
		});

		// Store span in Hono context for downstream middleware
		c.set("rootSpan", span);

		// Execute downstream middleware within the OTel trace context
		const otelCtx = trace.setSpan(context.active(), span);
		try {
			await context.with(otelCtx, () => next());

			// Set status code after response is generated
			span.setAttribute("http.status_code", c.res.status);

			if (c.res.status >= 400) {
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: `HTTP ${c.res.status}`,
				});
			} else {
				span.setStatus({ code: SpanStatusCode.OK });
			}
		} catch (error) {
			span.setStatus({ code: SpanStatusCode.ERROR });
			if (error instanceof Error) {
				span.recordException(error);
			}
			throw error;
		} finally {
			span.end();
		}
	};
}
