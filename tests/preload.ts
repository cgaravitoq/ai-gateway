/**
 * Test preload script — sets required environment variables for test runs.
 * Bun loads this before any test file via the `preload` config in package.json.
 */

// Set minimum required env vars that the gateway needs to parse
// These are dummy values — no real API calls are made in tests.
if (!process.env.OPENAI_API_KEY) {
	process.env.OPENAI_API_KEY = "sk-test-key-for-testing";
}

// Disable cache and rate limiting in tests
process.env.CACHE_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.NODE_ENV = "test";
