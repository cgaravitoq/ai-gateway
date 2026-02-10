import { type Span, SpanStatusCode, type Tracer, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BasicTracerProvider,
	BatchSpanProcessor,
	ConsoleSpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

let provider: BasicTracerProvider | null = null;

/**
 * Initialize OpenTelemetry tracing.
 *
 * Uses OTLP HTTP exporter when `OTEL_EXPORTER_OTLP_ENDPOINT` is set,
 * otherwise falls back to ConsoleSpanExporter (stdout).
 *
 * Respects `OTEL_ENABLED` env var — when "false", telemetry is a no-op.
 */
export function initTelemetry(): void {
	const enabled = process.env.OTEL_ENABLED !== "false";
	if (!enabled) return;

	const serviceName = process.env.OTEL_SERVICE_NAME || "ai-gateway";
	const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

	const resource = resourceFromAttributes({
		[ATTR_SERVICE_NAME]: serviceName,
		[ATTR_SERVICE_VERSION]: "0.1.0",
	});

	const spanProcessors = [];

	if (otlpEndpoint) {
		const exporter = new OTLPTraceExporter({
			url: `${otlpEndpoint}/v1/traces`,
		});
		spanProcessors.push(new BatchSpanProcessor(exporter));
	} else {
		// Fallback: log spans to stdout (useful for local development)
		spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
	}

	provider = new BasicTracerProvider({ resource, spanProcessors });

	// Register as the global tracer provider
	trace.setGlobalTracerProvider(provider);
}

/**
 * Gracefully shut down the tracer provider, flushing any pending spans.
 */
export async function shutdownTelemetry(): Promise<void> {
	if (provider) {
		await provider.shutdown();
		provider = null;
	}
}

/**
 * Get a named tracer instance.
 *
 * Returns the OTel tracer if telemetry is initialized, otherwise
 * returns a no-op tracer (safe to call unconditionally).
 */
export function getTracer(name = "ai-gateway"): Tracer {
	return trace.getTracer(name);
}

/**
 * Helper: set span error status and record the exception.
 */
export function recordSpanError(span: Span, error: unknown): void {
	span.setStatus({ code: SpanStatusCode.ERROR });
	if (error instanceof Error) {
		span.recordException(error);
	} else {
		span.recordException(new Error(String(error)));
	}
}

export { SpanStatusCode };
