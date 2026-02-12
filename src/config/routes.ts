import type { ProviderName } from "@/config/providers.ts";

/** A single provider + model pair used as a routing target. */
export interface RouteTarget {
	provider: ProviderName;
	model: string;
}

/** Routing configuration for a model alias — primary target with optional fallbacks. */
export interface RouteConfig {
	/** Primary target for this model alias */
	primary: RouteTarget;
	/** Fallback targets tried in order if primary fails */
	fallbacks?: RouteTarget[];
}

/**
 * Static routing configuration: maps model aliases to provider targets.
 * Models not in this map are auto-detected by prefix (e.g., gpt-4o → openai).
 */
export const ROUTE_CONFIG: Record<string, RouteConfig> = {
	// Virtual model aliases — route to best available
	"smart-model": {
		primary: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
		fallbacks: [{ provider: "openai", model: "gpt-4o" }],
	},
	"fast-model": {
		primary: { provider: "openai", model: "gpt-4o-mini" },
		fallbacks: [{ provider: "google", model: "gemini-2.0-flash" }],
	},
	// Direct model names can also have fallbacks
	"gpt-4o": {
		primary: { provider: "openai", model: "gpt-4o" },
		fallbacks: [{ provider: "anthropic", model: "claude-sonnet-4-20250514" }],
	},
	"claude-sonnet-4-20250514": {
		primary: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
		fallbacks: [{ provider: "openai", model: "gpt-4o" }],
	},
	"gemini-2.0-flash": {
		primary: { provider: "google", model: "gemini-2.0-flash" },
	},
};
