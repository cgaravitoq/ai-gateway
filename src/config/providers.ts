import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/config/env.ts";

export type ProviderName = "openai" | "anthropic" | "google";

export interface ProviderConfig {
	name: ProviderName;
	enabled: boolean;
}

/** Check which providers have API keys configured */
export function getEnabledProviders(): ProviderConfig[] {
	const providers: ProviderConfig[] = [
		{
			name: "openai",
			enabled: !!env.OPENAI_API_KEY,
		},
		{
			name: "anthropic",
			enabled: !!env.ANTHROPIC_API_KEY,
		},
		{
			name: "google",
			enabled: !!env.GOOGLE_API_KEY,
		},
	];

	return providers;
}

/** Create provider SDK instances from environment variables */
export function createProviderInstances() {
	const providers: Record<string, ReturnType<typeof createOpenAI>> = {};

	if (env.OPENAI_API_KEY) {
		providers.openai = createOpenAI({
			apiKey: env.OPENAI_API_KEY,
		});
	}

	if (env.ANTHROPIC_API_KEY) {
		providers.anthropic = createAnthropic({
			apiKey: env.ANTHROPIC_API_KEY,
		}) as unknown as ReturnType<typeof createOpenAI>;
	}

	if (env.GOOGLE_API_KEY) {
		providers.google = createGoogleGenerativeAI({
			apiKey: env.GOOGLE_API_KEY,
		}) as unknown as ReturnType<typeof createOpenAI>;
	}

	return providers;
}
