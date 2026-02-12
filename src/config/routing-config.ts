import { z } from "zod/v4";
import { env } from "@/config/env.ts";
import type { RoutingRule } from "@/types/routing.ts";

// Re-export MODEL_PRICING from the centralized models config
export { MODEL_PRICING } from "@/config/models.ts";

// ── Schema ────────────────────────────────────────────────

/** Routing configuration schema (validated at startup) */
export const RoutingConfigSchema = z.object({
	/** Default routing strategy */
	defaultStrategy: z.enum(["cost", "latency", "balanced", "capability"]).default("balanced"),
	/** Global request timeout (ms) — should match ROUTING_TIMEOUT_MS from env */
	defaultTimeoutMs: z.number().positive().default(60_000),
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
