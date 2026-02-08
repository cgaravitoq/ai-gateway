import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";

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
			enabled: !!process.env.OPENAI_API_KEY,
		},
		{
			name: "anthropic",
			enabled: !!process.env.ANTHROPIC_API_KEY,
		},
		{
			name: "google",
			enabled: !!process.env.GOOGLE_API_KEY,
		},
	];

	return providers;
}

/** Create provider SDK instances from environment variables */
export function createProviderInstances() {
	const providers: Record<string, ReturnType<typeof createOpenAI>> = {};

	if (process.env.OPENAI_API_KEY) {
		providers.openai = createOpenAI({
			apiKey: process.env.OPENAI_API_KEY,
		});
	}

	if (process.env.ANTHROPIC_API_KEY) {
		providers.anthropic = createAnthropic({
			apiKey: process.env.ANTHROPIC_API_KEY,
		}) as unknown as ReturnType<typeof createOpenAI>;
	}

	if (process.env.GOOGLE_API_KEY) {
		providers.google = createGoogleGenerativeAI({
			apiKey: process.env.GOOGLE_API_KEY,
		}) as unknown as ReturnType<typeof createOpenAI>;
	}

	return providers;
}
