# AI Gateway Audit - Round 2

**Auditor**: Antigravity (Google DeepMind)
**Date**: Feb 11, 2026
**Target**: `src/` (Bun + Hono + Vercel AI SDK)

## Executive Summary

This second-round audit focused on verifying 12 previously reported fixes and identifying new issues. While most specific fixes (e.g., auth, rate limiting, body size) were implemented correctly, **critical architectural flaws** were discovered that render the core "Smart Routing" and "Resiliency" (fallback/retry) features non-functional.

The codebase contains high-quality components (Rule Engine, Fallback Handler) that are **disconnected** from the actual request processing pipeline. The Gateway currently operates as a static proxy with no automatic retries or dynamic routing, despite these features being implemented in isolation.

**Production Readiness**: 🔴 **NOT READY**
The system is currently effectively a static proxy. The "Smart Router" and "Circuit Breaker" features are implemented but bypassed in the main request path.

### Findings Summary
| Severity | Count | Description |
| :--- | :---: | :--- |
| 🔴 **Critical** | 2 | Smart Router ignored; Fallback/Retry logic unused |
| 🟠 **High** | 2 | Circuit Breaker bypassed on exceptions; Race condition in probe logic |
| 🟡 **Medium** | 2 | Timing attack in Auth; Cache suboptimal (Top-1 limitation) |
| 🔵 **Low** | 1 | Rough token estimation |

---

## 1. Critical Findings

### 1.1. Smart Routing Decision is Ignored
- **Severity**: 🔴 Critical
- **Category**: Code Quality / Functionality
- **File(s)**: `src/routes/chat.ts`, `src/middleware/smart-router.ts`
- **Description**:
  The `smart-router` middleware calculates the optimal provider and stores it in the Hono context (`c.set("selectedProvider", ...)`). However, the `chat.ts` route handler **completely ignores** this context and calls `routeModel(body.model)`, which performs a static lookup.
  The expensive smart routing logic runs for every request but has **zero effect** on the actual LLM call.
- **Suggested Fix**:
  Update `src/routes/chat.ts` to check `c.get("selectedProvider")` first. If present, use the provider and model from the context; otherwise fall back to `routeModel`.

### 1.2. Fallback & Retry Logic is Unused
- **Severity**: 🔴 Critical
- **Category**: Reliability
- **File(s)**: `src/routes/chat.ts`, `src/middleware/smart-router.ts`
- **Description**:
  The `FallbackHandler` and `ModelSelector.selectWithFallback` classes are implemented but **never called** in the request lifecycle.
  `smart-router` calls `selectProvider` (single selection), and `chat.ts` calls `generateText` / `streamText` directly on a single provider.
  If the upstream provider fails (5xx, timeout), the request fails immediately. The sophisticated retry/backoff/failover logic is dead code.
- **Suggested Fix**:
  Refactor `chat.ts` to use `modelSelector.selectWithFallback()` (if moving logic to route) or wrap the `generateText` call in a usage of `fallbackHandler`. Ideally, `smart-router` should attach the *strategy* (list of candidates), and `chat.ts` should execute it using `FallbackHandler`.

---

## 2. High Severity Findings

### 2.1. Circuit Breaker Bypassed on Exceptions
- **Severity**: 🟠 High
- **Category**: Reliability
- **File(s)**: `src/middleware/smart-router.ts`, `src/middleware/error-handler.ts`
- **Description**:
  The `smart-router` middleware only reports failures to the `ProviderRegistry` (circuit breaker) when the downstream handler returns a non-200 HTTP response.
  If `chat.ts` throws an exception (e.g., `TimeoutError`, network error, or `APICallError` from Vercel SDK), the error bubbles up to the global `errorHandler`.
  `errorHandler` updates `errorTracker` (metrics) but **does not update** `providerRegistry`.
  **Impact**: The circuit breaker will never trip on network timeouts or connection refusals, only on graceful 5xx responses.
- **Suggested Fix**:
  Wrap the `await next()` call in `smart-router.ts` with a `try/catch` block. In the `catch` block, call `providerRegistry.reportError()` before re-throwing.

### 2.2. Race Condition in Circuit Breaker Probe
- **Severity**: 🟠 High
- **Category**: Reliability / Concurrency
- **File(s)**: `src/routing/provider-registry.ts`
- **Description**:
  `isAvailableEntry` mutates state (`halfOpenProbeInFlight = true`) inside a read operation (`getProviderStates`).
  While this intends to enforce a "single probe" policy, it relies on the side-effect of `selectProvider` calling `getProviderStates`.
  If multiple requests come in, only the first one sees the provider as "available". This is correct behavior, but implementing it via a getter side-effect is brittle.
  More importantly, if any *other* component calls `getProviderStates` (e.g., a dashboard or health check), it will accidentally consume the single probe token, preventing the actual router from testing the provider.
- **Suggested Fix**:
  Separate query (`isAvailable`) from mutation (`consumeProbeToken`). The router should explicitly request to "claim" the probe attempt.

---

## 3. Medium Severity Findings

### 3.1. Timing Attack in Auth Middleware
- **Severity**: 🟡 Medium
- **Category**: Security
- **File(s)**: `src/middleware/auth.ts`
- **Description**:
  The API key comparison `token !== env.GATEWAY_API_KEY` uses a standard string comparison, which is vulnerable to timing attacks (though practical exploitability is low for this length).
- **Suggested Fix**:
  Use `crypto.timingSafeEqual` (converting strings to Buffers) to perform constant-time comparison.

### 3.2. Suboptimal Semantic Cache Retrieval (Top-1)
- **Severity**: 🟡 Medium
- **Category**: Performance
- **File(s)**: `src/services/cache/semantic-cache.ts`
- **Description**:
  `semanticSearch` queries Redis with `KNN 1` (Top-1). It then checks if the returned document matches `temperature` and `maxTokens`. If not, it returns a miss.
  A valid cache hit might exist in the Top-2 or Top-3 results (with slightly lower similarity but matching parameters), but it is ignored. This unnecessarily reduces the cache hit rate.
- **Suggested Fix**:
  Increase retrieval to `KNN 5` and filter the results in memory to find the first match that satisfies the parameter constraints.

---

## 4. Verification of Previous Fixes

| Status | Issue | Verification |
| :--- | :--- | :--- |
| ✅ Fixed | Auth Middleware | Added `authMiddleware` on `/v1/*` and `/metrics`. |
| ✅ Fixed | Redis TAG Injection | `validateModelName` and `escapeTag` implemented correctly. |
| ✅ Fixed | X-Timeout-Ms Clamping | `Math.min/max` logic correct in `timeout.ts`. |
| ✅ Fixed | Metrics Auth | `/metrics` is protected in `health.ts`. |
| ✅ Fixed | Rate Limiter Fail Closed | Rejects missing/unknown models/providers. |
| ⚠️ Partial | Circuit Breaker Probe | "Single probe" logic exists but has race condition issues (see 2.2). |
| ✅ Fixed | Body Size Limit | `bodyLimit` middleware added (1MB). |
| ✅ Fixed | Embedding Timeout | 10s timeout added in `embeddings.ts`. |
| ✅ Fixed | Cache Key Params | `temperature` and `maxTokens` included in cache check. |
| ✅ Fixed | Streaming Cost Est. | `chat.ts` estimates tokens if usage is missing. |
| ✅ Fixed | Client Disconnect | `streamSSE` aborts upstream on client disconnect. |

---

## 5. Other Observations

- **Request Body Consumption**: Hono v4 caches `c.req.json()`, so the multiple reads in `timeoutMiddleware`, `smart-router`, and `chat.ts` are safe.
- **Token Estimation**: `length / 4` is a very rough heuristic. Consider using a proper tokenizer (e.g., `tiktoken` or `js-tiktoken`) if cost accuracy is important.
- **In-Memory State**: The gateway uses in-memory state for rate limiting, circuit breaking, and metrics. This will not work correctly if deployed with multiple replicas (horizontal scaling). Redis should be used for shared state in production.
