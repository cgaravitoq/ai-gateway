import type { ProviderName } from "@/config/providers.ts";

/** Routing strategy determines how providers are ranked */
export type RoutingStrategy = "cost" | "latency" | "balanced" | "capability";

/** Condition types for routing rules */
export type RuleCondition =
	| { type: "cost"; maxCostPer1kTokens: number }
	| { type: "latency"; maxMs: number }
	| { type: "capability"; required: ModelCapability[] };

/** Capabilities a model may support */
export type ModelCapability =
	| "streaming"
	| "vision"
	| "function_calling"
	| "json_mode"
	| "long_context";

/** A single routing rule with priority */
export interface RoutingRule {
	/** Unique rule identifier */
	id: string;
	/** Human-readable description */
	description?: string;
	/** Higher priority rules evaluate first */
	priority: number;
	/** Condition to evaluate */
	condition: RuleCondition;
	/** Providers to prefer when this rule matches */
	preferredProviders?: ProviderName[];
	/** Providers to exclude when this rule matches */
	excludeProviders?: ProviderName[];
}

/** A provider scored and ranked by the routing engine */
export interface RankedProvider {
	provider: ProviderName;
	modelId: string;
	/** Composite score (higher = better) */
	score: number;
	/** Rules that matched for this provider */
	matchedRules: string[];
}

/** Request metadata used for routing decisions */
export interface RequestMetadata {
	/** Requested model (may be alias or specific) */
	model: string;
	/** Estimated input tokens */
	estimatedInputTokens?: number;
	/** Maximum output tokens */
	maxTokens?: number;
	/** Whether streaming is requested */
	stream?: boolean;
	/** Required capabilities */
	requiredCapabilities?: ModelCapability[];
	/** Custom routing hints from headers */
	routingHints?: {
		/** Prefer specific strategy */
		strategy?: RoutingStrategy;
		/** Prefer specific provider */
		preferProvider?: ProviderName;
		/** Maximum acceptable latency */
		maxLatencyMs?: number;
		/** Maximum cost budget */
		maxCostPer1kTokens?: number;
	};
}
