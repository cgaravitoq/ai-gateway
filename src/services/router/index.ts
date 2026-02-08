import type { LanguageModel } from "ai";
import { ROUTE_CONFIG, type RouteTarget } from "@/config/routes.ts";
import { detectProvider, getModel, type ProviderName } from "@/services/providers/index.ts";

export interface ResolvedRoute {
	model: LanguageModel;
	provider: ProviderName;
	modelId: string;
}

/**
 * Resolve a model name to an ordered list of route targets.
 * 1. Check explicit route config
 * 2. Auto-detect provider from model name prefix
 * 3. Default to OpenAI if nothing matches
 */
export function resolveTargets(requestedModel: string): RouteTarget[] {
	// Check explicit route configuration
	const route = ROUTE_CONFIG[requestedModel];
	if (route) {
		return [route.primary, ...(route.fallbacks ?? [])];
	}

	// Auto-detect provider from model prefix
	const detectedProvider = detectProvider(requestedModel);
	if (detectedProvider) {
		return [{ provider: detectedProvider, model: requestedModel }];
	}

	// Default: try as OpenAI model
	return [{ provider: "openai", model: requestedModel }];
}

/**
 * Route a model name to a Vercel AI SDK LanguageModel with fallback support.
 * Tries each target in order; throws if all fail.
 */
export function routeModel(requestedModel: string): ResolvedRoute {
	const targets = resolveTargets(requestedModel);
	const errors: Error[] = [];

	for (const target of targets) {
		try {
			const model = getModel(target.provider, target.model);
			return {
				model,
				provider: target.provider,
				modelId: target.model,
			};
		} catch (err) {
			errors.push(err instanceof Error ? err : new Error(String(err)));
		}
	}

	throw new Error(
		`All providers failed for model "${requestedModel}": ${errors.map((e) => e.message).join("; ")}`,
	);
}
