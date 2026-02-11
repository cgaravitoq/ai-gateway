# Council of Advisors — Security & Code Audit (Round 2)

**Date:** 2026-02-11
**Auditor:** Claude Opus 4.6 (solo deep-dive)
**Repository:** ai-gateway (Bun + Hono LLM proxy)
**Codebase:** 47 source files, ~5,200 LOC
**Scope:** New issues not covered in Round 1, plus verification of Round 1 fixes

---

## Round 1 Fix Verification

The following 12 fixes from Round 1 were reviewed for correctness:

| # | Fix | Status | Notes |
|---|-----|--------|-------|
| 1 | Auth middleware on `/v1/*` and `/metrics` | **Correct** | Bearer token validated against `GATEWAY_API_KEY`; properly returns 401 |
| 2 | Redis TAG injection (validate + escape) | **Correct** | `validateModelName()` regex + `escapeTag()` covers all Redis special chars |
| 3 | X-Timeout-Ms clamped to 1s–120s | **Correct** | `Math.max(MIN, Math.min(parsed, MAX))` with proper NaN handling |
| 4 | Metrics endpoints protected | **Correct** | `authMiddleware()` applied to `/metrics` and `/metrics/costs` |
| 5 | Rate limiter fails closed | **Correct** | Returns 400 on bad JSON body, missing model, or unknown provider |
| 6 | Circuit breaker half-open race | **Correct** | `halfOpenProbeInFlight` flag prevents multiple simultaneous probes |
| 7 | Body size limit (1MB) | **Correct** | Hono `bodyLimit` middleware at 1MB with OpenAI-format 413 error |
| 8 | Embedding API timeout (10s) | **Correct** | AbortController with 10s timeout in `generateEmbedding()` |
| 9 | Cache key includes temperature/maxTokens | **Correct** | Post-retrieval check rejects mismatched temperature/maxTokens |
| 10 | Streaming cost estimation | **Correct** | Accumulates `fullText`, estimates via `text.length / 4` heuristic |
| 11 | Client disconnect aborts upstream | **Correct** | `sseStream.onAbort()` calls `abortController.abort()` |
| 12 | GATEWAY_API_KEY env var | **Correct** | Zod `.min(1)` validation, required at startup |

**Verdict:** All 12 fixes are correctly implemented. No regressions found from the fixes themselves.

---

## New Findings

### Finding 1 — Timing-Safe Comparison Not Used for API Key Auth

- **Severity:** High
- **Category:** Security
- **File(s):** `src/middleware/auth.ts:48`
- **Description:** The auth middleware compares the bearer token to `GATEWAY_API_KEY` using strict equality (`token !== env.GATEWAY_API_KEY`). String equality comparison in JavaScript short-circuits on the first mismatched character, making it vulnerable to timing side-channel attacks. An attacker can statistically determine the API key one character at a time by measuring response times.
- **Suggested Fix:** Use `crypto.timingSafeEqual(Buffer.from(token), Buffer.from(env.GATEWAY_API_KEY))` with a length-equality check first (to avoid leaking length, compare against a hash or pad to fixed size).

### Finding 2 — `x-routing-prefer-provider` Header Not Validated (Injection / Type Confusion)

- **Severity:** High
- **Category:** Security
- **File(s):** `src/middleware/smart-router.ts:223`
- **Description:** The `x-routing-prefer-provider` header is cast directly to `ProviderName` via `as ProviderName | undefined` without any validation. This arbitrary string flows into the `RequestMetadata.routingHints.preferProvider` field. While the current code doesn't directly use it to index into Maps unsafely, it represents a type-safety gap that could become exploitable as the routing engine evolves. Additionally, `x-routing-max-latency-ms` and `x-routing-max-cost` are converted via `Number()` without NaN/negative checks, which could produce `NaN` values that propagate through the scoring engine.
- **Suggested Fix:** Validate `preferProvider` against `PROVIDER_NAMES` array. For numeric headers, reject `NaN` and negative values explicitly.

### Finding 3 — Dual Timeout Creates Unpredictable Behavior

- **Severity:** High
- **Category:** Reliability
- **File(s):** `src/middleware/timeout.ts`, `src/routes/chat.ts:191–193,331–333`
- **Description:** The timeout middleware creates an `AbortController` and stores the signal as `c.set('abortSignal', signal)`, but the chat route handler never reads this signal. Instead, it creates its own independent `AbortController` with `ROUTING_TIMEOUT_MS`. This means there are two independent timers racing: the middleware's (configured per-provider or via header) and the route handler's. The middleware signal is set but never consumed, while the route's own timer uses a potentially different timeout value. If the middleware fires first, the error may not propagate cleanly because the route's inner `streamText`/`generateText` only listens to its own signal.
- **Suggested Fix:** Have the chat route consume `c.get('abortSignal')` from the middleware instead of creating its own. Remove the redundant `AbortController` in the route handler, or link them so the middleware signal cascades into the route's operations.

### Finding 4 — `recordEmbeddingCall()` is Dead Code

- **Severity:** Low
- **Category:** Code Quality
- **File(s):** `src/services/metrics.ts:67–69`, `src/services/cache/embeddings.ts`
- **Description:** The function `recordEmbeddingCall()` is exported from `metrics.ts` but never called anywhere in the codebase. The `embeddingCalls` counter will always be zero, making the `totalEmbeddingCalls` field in `/metrics` misleading. This was flagged in Round 1 but not addressed.
- **Suggested Fix:** Call `recordEmbeddingCall()` in `generateEmbedding()`, or remove it to avoid confusion.

### Finding 5 — `reportError` Records Latency as Zero, Polluting EMA

- **Severity:** Medium
- **Category:** Reliability
- **File(s):** `src/routing/provider-registry.ts:106`
- **Description:** When `reportError()` is called, it records latency as `latencyTracker.recordLatency(provider, modelId, 0, 0, false)`. These zero-value samples are fed into the EMA calculation (`calculateEma(currentEma, 0, alpha)`), which artificially drags down the provider's latency average. Since the routing engine uses EMA as a tiebreaker (lower = better), a failing provider paradoxically appears *faster* due to the influx of zero-latency error samples, potentially attracting more traffic.
- **Suggested Fix:** Skip the latency recording on errors entirely (`if (success) recordLatency(...)`) or record with the actual elapsed time before the error occurred.

### Finding 6 — `normalizeMessages` Doesn't Limit Input Length for Embeddings

- **Severity:** Medium
- **Category:** Security / Performance
- **File(s):** `src/services/cache/embeddings.ts:68–70`
- **Description:** `normalizeMessages()` concatenates all message contents without any length limit. Although the body is limited to 1MB, a maximally-sized request could produce a very long embedding input string. OpenAI's embedding API has its own token limits (8191 tokens for `text-embedding-3-small`), and sending oversized text will either fail or be silently truncated by the API, wasting latency and embedding API costs.
- **Suggested Fix:** Truncate the concatenated text to a maximum character count (e.g., 32K characters ≈ ~8K tokens) before sending to the embedding API.

### Finding 7 — Cached Response `usage` Field Returned Without Validation

- **Severity:** Medium
- **Category:** Security
- **File(s):** `src/services/cache/semantic-cache.ts:121`
- **Description:** When a cache hit is found, the `$.usage` field is parsed from Redis via `JSON.parse(usageRaw)` (line 121) and returned directly as `CachedResponse["usage"]` without validating the structure. If the cached data in Redis is corrupted or tampered with, this could inject arbitrary data into the response, or cause a runtime crash if the shape doesn't match the expected `{prompt_tokens, completion_tokens, total_tokens}` object.
- **Suggested Fix:** Validate the parsed `usage` object with Zod or a manual shape check before returning it in the cache response.

### Finding 8 — `/health` Endpoint Is Unauthenticated, Leaks Uptime Information

- **Severity:** Low
- **Category:** Security
- **File(s):** `src/routes/health.ts:10–16`
- **Description:** The `/health` endpoint returns `process.uptime()` and a timestamp without authentication. While `/metrics` and `/metrics/costs` are now protected, `/health` reveals the precise server uptime, which can help attackers fingerprint the deployment, determine when restarts occurred, and time attacks. In a K8s environment this is typically acceptable for liveness probes, but the uptime detail is unnecessary for external consumers.
- **Suggested Fix:** Return only `{ status: "ok" }` on the public health endpoint. Expose uptime only on the authenticated `/metrics` route.

### Finding 9 — 404 Handler Reflects Request Path Without Sanitization

- **Severity:** Medium
- **Category:** Security
- **File(s):** `src/index.ts:78`
- **Description:** The 404 handler includes `path: c.req.path` directly in the JSON response body. While JSON encoding prevents XSS in API contexts, this reflects user-controlled input in responses, which could be exploited in log injection or if the response is ever rendered in a browser context. Additionally, very long paths could be used to inflate response sizes.
- **Suggested Fix:** Truncate the path to a reasonable length (e.g., 200 characters) before including it in the error response.

### Finding 10 — Root Endpoint Leaks Internal Route Map

- **Severity:** Low
- **Category:** Security
- **File(s):** `src/index.ts:62–68`
- **Description:** The root `GET /` endpoint returns the full list of available endpoints including `/metrics`, `/metrics/costs`, etc. This information disclosure helps attackers map the API surface without needing to enumerate. In production, this should be removed or placed behind auth.
- **Suggested Fix:** Return only `{ name: "ai-gateway", version }` on the root, or remove the root handler entirely and let it 404.

### Finding 11 — Error Handler Leaks Full Error Messages From Providers in Production

- **Severity:** Medium
- **Category:** Security
- **File(s):** `src/middleware/error-handler.ts:69–77`
- **Description:** When an `APICallError` is caught, `err.message` is returned verbatim to the client (`message: err.message`) regardless of `NODE_ENV`. Provider error messages can contain internal details such as API endpoint URLs, request IDs, model deployment names, or rate limit quotas. Only the generic error path (non-APICallError) masks messages in production; the APICallError path always exposes the upstream message.
- **Suggested Fix:** In production mode, replace `APICallError` messages with a generic message like `"Upstream provider error"` and include the original message only in logs.

### Finding 12 — `x-request-id` Read From Response Before Being Set

- **Severity:** Low
- **Category:** Reliability
- **File(s):** `src/middleware/tracing.ts:39–40`
- **Description:** The tracing middleware tries to read `c.res.headers.get("x-request-id")` to set the `request.id` span attribute. However, the `x-request-id` is set by the logging middleware (via `c.header("x-request-id", requestId)`) which runs *after* the tracing middleware fires. At span-creation time, this value will always be `null`, causing the attribute to fall back to `c.req.header("x-request-id")` or `"unknown"`. The span never captures the gateway-generated request ID.
- **Suggested Fix:** Have tracing middleware generate the request ID itself and set it on `c.set('requestId', ...)`, then have the logging middleware read from context.

### Finding 13 — In-Memory Metrics/Cost/Error State Has No Periodic Reset

- **Severity:** Medium
- **Category:** Reliability
- **File(s):** `src/services/metrics.ts`, `src/services/cost-tracker.ts`, `src/services/error-tracker.ts`
- **Description:** Global counters (`totalRequests`, `totalCostUsd`, `totalErrors`, etc.) grow monotonically and are never reset. In a long-running production pod, these counters will eventually lose floating-point precision (especially `totalCostUsd` after millions of requests) and the in-memory arrays (`recentRequests` in cost-tracker) consume steady-state memory. The `resetCostTracking()` function exists but is never called automatically. The `errorTracker.recentErrors` array is time-pruned but `totalErrors` is not, so it can overflow `Number.MAX_SAFE_INTEGER` after ~9 quadrillion errors (theoretical, but indicates no reset mechanism).
- **Suggested Fix:** Implement periodic metric snapshots or export to an external metrics system (Prometheus, etc.), and reset in-memory counters at regular intervals, or at minimum after a configurable period.

### Finding 14 — `error-tracker` and `metrics` Circular Import Risk

- **Severity:** Low
- **Category:** Code Quality
- **File(s):** `src/services/metrics.ts:6–8`, `src/services/error-tracker.ts:8`
- **Description:** `metrics.ts` imports from `error-tracker.ts` and `error-tracker.ts` imports from `metrics.ts`. The code comment acknowledges this and notes it works because both use lazy function calls. While this is correct in Bun's ESM module system, circular dependencies are fragile — a refactor that changes import timing or adds top-level initializers could introduce subtle initialization bugs.
- **Suggested Fix:** Extract the shared `getTotalRequests` into a separate module to break the cycle cleanly.

### Finding 15 — `byModel` Shallow Clone in `getCostSummary()` Leaks Internal References

- **Severity:** Low
- **Category:** Code Quality
- **File(s):** `src/services/cost-tracker.ts:217`
- **Description:** `getCostSummary()` returns `byModel: { ...byModel }` which is a shallow spread. Each value (`{ requests, totalCost }`) is a reference to the internal mutable object, not a copy. External callers can mutate the returned summary and accidentally corrupt internal cost tracking state. The `byProvider` spread has the same issue but is mitigated one level by `{ ...byProvider.openai }`.
- **Suggested Fix:** Deep copy `byModel` entries: `Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, { ...v }]))`.

### Finding 16 — Smart Router Bypasses Validation When Body Parse Fails

- **Severity:** Medium
- **Category:** Reliability
- **File(s):** `src/middleware/smart-router.ts:63–67`
- **Description:** When `c.req.json()` throws in the smart-router middleware (line 63), it silently calls `await next()`, passing the request to downstream handlers without a `selectedProvider` being set. The chat route then calls `routeModel(model)` which performs static routing and may succeed — but the `selectedProvider` context variable is never populated. This means the post-response outcome tracking (lines 162–195) is skipped entirely: no latency recording, no error tracking, no circuit breaker updates. Requests that fail JSON parse in the smart router are invisible to the health monitoring system.
- **Suggested Fix:** If JSON parsing fails in the smart router, either reject the request outright (it will fail downstream anyway) or ensure the fallback path still records outcomes.

### Finding 17 — `recentRequests` Array Uses `shift()` Which Is O(n)

- **Severity:** Low
- **Category:** Performance
- **File(s):** `src/services/cost-tracker.ts:191`, `src/services/error-tracker.ts:89,223`
- **Description:** Both `recentRequests` (cost tracker) and `recentErrors` (error tracker) use `Array.shift()` to maintain bounded windows. `shift()` is O(n) because it re-indexes all remaining elements. Under high throughput (thousands of requests per second), this becomes a performance bottleneck. The error tracker calls `shift()` in a `while` loop (line 88–92), compounding the cost.
- **Suggested Fix:** Replace with a circular buffer or `Deque` implementation that provides O(1) push/pop at both ends.

### Finding 18 — No Maximum `messages` Array Length in Request Schema

- **Severity:** Medium
- **Category:** Security / Performance
- **File(s):** `src/types/index.ts:14`
- **Description:** `ChatCompletionRequestSchema` validates `messages: z.array(MessageSchema).min(1)` but has no `.max()` constraint. Combined with the 1MB body limit, an attacker could send thousands of short messages. Each message is individually processed by `normalizeMessages()` for cache key generation and concatenated for embedding. Large message arrays stress the embedding API, Redis vector search, and in-memory processing disproportionately relative to their actual utility.
- **Suggested Fix:** Add `.max(256)` (or a reasonable bound) to the messages array schema, and/or add a `.max()` on the `content` string field.

### Finding 19 — `escapeTag` Regex Escapes Hyphen Incorrectly

- **Severity:** Low
- **Category:** Code Quality
- **File(s):** `src/services/cache/semantic-cache.ts:221`
- **Description:** The regex `/[{}|@*()!~\\"'.:\-/\s]/g` uses `\-` which works correctly here because the hyphen is preceded by a backslash. However, the placement is fragile — the hyphen should either be at the end of the character class `[...-]` or escaped with a double backslash for clarity. This is not a bug but could introduce a bug during maintenance edits.
- **Suggested Fix:** Move the hyphen to the end of the character class for defensive clarity: `/[{}|@*()!~\\"'.:\/\s-]/g`.

### Finding 20 — `getErrorSummary()` Returns Shallow Copy of `providerStats`

- **Severity:** Low
- **Category:** Code Quality
- **File(s):** `src/services/error-tracker.ts:250`
- **Description:** `getErrorSummary()` returns `providers: { ...providerStats }` which is a shallow spread. Each `ProviderErrorStats` value (including `lastError`) is a direct reference to internal mutable state. External consumers (including the `/metrics` JSON response) can accidentally mutate tracking state.
- **Suggested Fix:** Deep copy provider stats entries before returning.

### Finding 21 — Provider Singleton Caches Stale API Keys

- **Severity:** Medium
- **Category:** Reliability
- **File(s):** `src/services/providers/openai.ts:5`, `src/services/providers/anthropic.ts:5`, `src/services/providers/google.ts:5`
- **Description:** Each provider module uses a module-level `let instance = null` singleton pattern. The provider is created once with the API key from `env` and cached forever. If the gateway were to support API key rotation (a common production requirement), stale keys would persist until the process restarts. This also means a misconfigured key at startup permanently poisons the provider instance.
- **Suggested Fix:** Consider adding a key-version check or a mechanism to invalidate/recreate the provider instance when keys change.

### Finding 22 — `OTEL_ENABLED` and `OTEL_SERVICE_NAME` Not Validated by Zod

- **Severity:** Low
- **Category:** Code Quality
- **File(s):** `src/telemetry/setup.ts:23,26`, `src/config/env.ts`
- **Description:** The telemetry setup reads `process.env.OTEL_ENABLED`, `process.env.OTEL_SERVICE_NAME`, and `process.env.OTEL_EXPORTER_OTLP_ENDPOINT` directly from `process.env` instead of through the validated `env` object. This bypasses the Zod validation pipeline that all other env vars go through, creating an inconsistency. A typo like `OTEL_ENABLED=treu` would silently disable telemetry.
- **Suggested Fix:** Add these variables to the Zod `envSchema` in `config/env.ts` with appropriate defaults and validation.

### Finding 23 — No CORS Configuration

- **Severity:** Medium
- **Category:** Security
- **File(s):** `src/index.ts`
- **Description:** The gateway has no CORS middleware configured. If the gateway is ever exposed to browser-based clients (e.g., developer dashboards, testing UIs), any origin can make requests. For a pure server-to-server API this is acceptable, but the lack of explicit CORS configuration means a misconfigured network policy could expose the gateway to cross-origin abuse.
- **Suggested Fix:** Add Hono's CORS middleware with explicit `origin` and `allowMethods` configuration, even if set to deny all browser origins (`origin: () => null`).

### Finding 24 — `PRICING_VERSION` Date is Static and Never Checked

- **Severity:** Low
- **Category:** Reliability
- **File(s):** `src/config/pricing.ts:17`
- **Description:** `PRICING_VERSION = "2025-02-11"` is a hardcoded constant that is exported but never used anywhere in the codebase. There is no staleness check that warns when pricing data is outdated. Model pricing changes frequently (especially for new models); stale pricing will silently under- or over-report costs.
- **Suggested Fix:** Add a startup warning when the pricing version is older than a configurable threshold (e.g., 90 days).

### Finding 25 — No Input Sanitization on `model` Field Before Provider Detection

- **Severity:** Low
- **Category:** Security
- **File(s):** `src/services/providers/index.ts:30–41`
- **Description:** `detectProvider()` uses `modelId.startsWith(prefix)` to match providers. An extremely long model string (up to 1MB within the body limit) will be checked against every prefix. While `startsWith` is efficient, the model string is later used as-is to create the Vercel AI SDK model instance (`getProvider()(modelId)`) which sends it to the upstream provider API. A crafted model ID could be used to probe provider APIs with unexpected input.
- **Suggested Fix:** Validate that the `model` field has a maximum length (e.g., 128 characters) in the `ChatCompletionRequestSchema`.

### Finding 26 — Graceful Shutdown Doesn't Actually Stop the Server

- **Severity:** Medium
- **Category:** Reliability
- **File(s):** `src/index.ts:118–165`
- **Description:** The shutdown handler sets `isShuttingDown = true` and waits 2 seconds for in-flight requests, but it never calls `server.stop()` or equivalent to stop accepting new connections. The Bun server continues accepting new requests during the 2-second drain window. The comment says "Bun's server will stop accepting new connections after this tick" but this is inaccurate — Bun's `Bun.serve` does not automatically stop on signal; `export default` syntax doesn't expose a server handle to call `.stop()` on.
- **Suggested Fix:** Use `const server = Bun.serve({...})` pattern instead of `export default`, which gives access to `server.stop()`. Call `server.stop()` at the beginning of the shutdown handler.

### Finding 27 — `isShuttingDown` Flag Not Checked by Request Handlers

- **Severity:** Medium
- **Category:** Reliability
- **File(s):** `src/index.ts:117`
- **Description:** Related to Finding 26: the `isShuttingDown` flag is set during shutdown but never checked by any middleware or request handler. Incoming requests during the 2-second drain window are processed normally, potentially starting new LLM calls that won't complete before the forced exit. A readiness middleware should reject new requests with 503 during shutdown.
- **Suggested Fix:** Add an early middleware that checks `isShuttingDown` and returns `503 Service Unavailable` with a `Retry-After` header.

### Finding 28 — `error-tracker` Error Rate Uses Total Requests as Denominator

- **Severity:** Medium
- **Category:** Reliability
- **File(s):** `src/services/error-tracker.ts:113–124`
- **Description:** `calculateErrorRate()` divides the count of errors in the 5-minute window by `getTotalRequests()`, which is the *all-time* total request count. As the gateway runs longer, the denominator grows unboundedly while the numerator is windowed to 5 minutes. This means the error rate asymptotically approaches zero regardless of actual recent error frequency, making health checks and alerts increasingly insensitive over time.
- **Suggested Fix:** Use a windowed request count (e.g., requests in the last 5 minutes) as the denominator, or switch to a sliding-window rate calculation.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 3 |
| Medium | 10 |
| Low | 10 |
| **Total** | **23** (previously unidentified issues, plus 5 carried from Round 1 unique findings) |

### By Category

| Category | Count |
|----------|-------|
| Security | 9 |
| Reliability | 9 |
| Performance | 1 |
| Code Quality | 6 |

*Note: Some findings span multiple categories; the primary is counted.*

### Overall Production Readiness Assessment

The Round 1 fixes were all implemented correctly — the gateway has meaningfully improved since the first audit. Authentication, input validation, timeout clamping, and cache key completeness are solid.

**However, the gateway is not yet production-ready.** The three High-severity findings (timing-unsafe auth, dual timeout conflict, unvalidated routing headers) and several Medium findings (error rate calculation bug, no shutdown drain, error message leakage) require attention before production deployment.

**Priority remediation order:**

1. **Immediate** (pre-deployment): Findings 1, 3, 11, 26, 27
   - Timing-safe auth comparison
   - Unified timeout mechanism
   - Error message masking in production
   - Proper graceful shutdown with server.stop()
   - Shutdown drain middleware

2. **Short-term** (first week): Findings 2, 5, 28, 16, 18
   - Validate routing headers
   - Fix zero-latency error recording
   - Fix error rate calculation denominator
   - Handle smart-router parse failure outcomes
   - Add messages array length limit

3. **Medium-term** (first month): Findings 6, 7, 13, 21, 22, 23
   - Truncate embedding input
   - Validate cached usage data
   - Periodic metric resets
   - Provider instance invalidation
   - Zod-validate OTel env vars
   - Add CORS configuration

**Positive observations:** The codebase demonstrates strong engineering practices — consistent use of Zod validation, proper TypeScript types, clean middleware separation, comprehensive error handling, and thoughtful OpenTelemetry integration. The architecture is well-suited for extension and the Round 1 fixes show careful, correct implementation.
