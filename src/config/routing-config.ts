import { z } from "zod/v4";
import { env } from "@/config/env.ts";
import type { ProviderName } from "@/config/providers.ts";
import type { ModelPricing } from "@/types/metrics.ts";
import type { RoutingRule } from "@/types/routing.ts";

// ── Helper ────────────────────────────────────────────────

/** Create a typed ModelPricing entry without `as ProviderName` casts. */
function pricing(
	modelId: string,
	provider: ProviderName,
	inputPer1k: number,
	outputPer1k: number,
): ModelPricing {
	return { modelId, provider, inputPer1k, outputPer1k };
}

// ── Schema ────────────────────────────────────────────────

/** Routing configuration schema (validated at startup) */
export const RoutingConfigSchema = z.object({
	/** Default routing strategy */
	defaultStrategy: z.enum(["cost", "latency", "balanced", "capability"]).default("balanced"),
	/** Global request timeout (ms) */
	defaultTimeoutMs: z.number().positive().default(30_000),
	/** Maximum retries per request */
	maxRetries: z.number().int().min(0).max(5).default(2),
	/** Retry backoff base (ms) — actual delay = base * 2^attempt */
	retryBackoffBaseMs: z.number().positive().default(500),
	/** Rate limits per provider (requests per minute) */
	providerRateLimits: z.record(z.string(), z.number().positive()).default({}),
	/** Latency tracking EMA alpha (0-1, higher = more responsive) */
	latencyEmaAlpha: z.number().min(0).max(1).default(0.3),
	/** Latency window size for percentile calculations (samples) */
	latencyWindowSize: z.number().int().positive().default(100),
});

export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;

/** Load routing config from validated environment */
export function loadRoutingConfig(): RoutingConfig {
	return RoutingConfigSchema.parse({
		defaultStrategy: env.ROUTING_STRATEGY,
		defaultTimeoutMs: env.ROUTING_TIMEOUT_MS,
		maxRetries: env.ROUTING_MAX_RETRIES,
		retryBackoffBaseMs: env.ROUTING_RETRY_BACKOFF_MS,
		latencyEmaAlpha: env.ROUTING_LATENCY_ALPHA,
		latencyWindowSize: env.ROUTING_LATENCY_WINDOW,
	});
}

// ── Model Pricing ─────────────────────────────────────────

/** Default model pricing (static, updated periodically) */
export const MODEL_PRICING: readonly ModelPricing[] = [
	// OpenAI
	pricing("gpt-4o", "openai", 0.0025, 0.01),
	pricing("gpt-4o-mini", "openai", 0.00015, 0.0006),
	// Anthropic
	pricing("claude-sonnet-4-20250514", "anthropic", 0.003, 0.015),
	pricing("claude-haiku-3-5", "anthropic", 0.0008, 0.004),
	// Google
	pricing("gemini-2.0-flash", "google", 0.0001, 0.0004),
	pricing("gemini-2.0-pro", "google", 0.00125, 0.005),
] as const;

// ── Routing Rules ─────────────────────────────────────────

/** Default routing rules */
export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
	{
		id: "budget-mode",
		description: "Prefer cheapest provider when cost constraint is set",
		priority: 10,
		condition: { type: "cost", maxCostPer1kTokens: 0.005 },
		preferredProviders: ["google", "openai"],
	},
	{
		id: "low-latency",
		description: "Prefer fastest provider when latency constraint is set",
		priority: 20,
		condition: { type: "latency", maxMs: 1000 },
		preferredProviders: ["openai"],
	},
];
