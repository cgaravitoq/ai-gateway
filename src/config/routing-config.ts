import { z } from "zod/v4";
import type { ProviderName } from "@/config/providers.ts";
import type { ModelPricing } from "@/types/metrics.ts";
import type { RoutingRule } from "@/types/routing.ts";

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

/** Load routing config from environment */
export function loadRoutingConfig(): RoutingConfig {
	return RoutingConfigSchema.parse({
		defaultStrategy: process.env.ROUTING_STRATEGY || "balanced",
		defaultTimeoutMs: Number(process.env.ROUTING_TIMEOUT_MS) || 30_000,
		maxRetries: Number(process.env.ROUTING_MAX_RETRIES) || 2,
		retryBackoffBaseMs: Number(process.env.ROUTING_RETRY_BACKOFF_MS) || 500,
		latencyEmaAlpha: Number(process.env.ROUTING_LATENCY_ALPHA) || 0.3,
		latencyWindowSize: Number(process.env.ROUTING_LATENCY_WINDOW) || 100,
	});
}

/** Default model pricing (static, updated periodically) */
export const MODEL_PRICING: ModelPricing[] = [
	// OpenAI
	{ modelId: "gpt-4o", provider: "openai" as ProviderName, inputPer1k: 0.0025, outputPer1k: 0.01 },
	{
		modelId: "gpt-4o-mini",
		provider: "openai" as ProviderName,
		inputPer1k: 0.00015,
		outputPer1k: 0.0006,
	},
	// Anthropic
	{
		modelId: "claude-sonnet-4-20250514",
		provider: "anthropic" as ProviderName,
		inputPer1k: 0.003,
		outputPer1k: 0.015,
	},
	{
		modelId: "claude-haiku-3-5",
		provider: "anthropic" as ProviderName,
		inputPer1k: 0.0008,
		outputPer1k: 0.004,
	},
	// Google
	{
		modelId: "gemini-2.0-flash",
		provider: "google" as ProviderName,
		inputPer1k: 0.0001,
		outputPer1k: 0.0004,
	},
	{
		modelId: "gemini-2.0-pro",
		provider: "google" as ProviderName,
		inputPer1k: 0.00125,
		outputPer1k: 0.005,
	},
];

/** Default routing rules */
export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
	{
		id: "budget-mode",
		description: "Prefer cheapest provider when cost constraint is set",
		priority: 10,
		condition: { type: "cost", maxCostPer1kTokens: 0.005 },
		preferredProviders: ["google" as ProviderName, "openai" as ProviderName],
	},
	{
		id: "low-latency",
		description: "Prefer fastest provider when latency constraint is set",
		priority: 20,
		condition: { type: "latency", maxMs: 1000 },
		preferredProviders: ["openai" as ProviderName],
	},
];
