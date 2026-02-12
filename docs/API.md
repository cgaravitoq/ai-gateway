# API Reference

> AI Gateway — OpenAI-compatible API for multi-provider LLM routing with semantic caching.

**Base URL:** `http://localhost:3000`

---

## Table of Contents

- [Authentication](#authentication)
- [POST /v1/chat/completions](#post-v1chatcompletions)
- [GET /health](#get-health)
- [GET /ready](#get-ready)
- [GET /metrics](#get-metrics)
- [GET /metrics/costs](#get-metricscosts)
- [GET /](#get-)
- [Custom Headers](#custom-headers)
- [Error Format](#error-format)
- [Supported Models](#supported-models)

---

## Authentication

The gateway itself does not enforce API key authentication on incoming requests. Provider API keys are configured server-side via environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`).

---

## POST /v1/chat/completions

Create a chat completion. Fully compatible with the [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat/create).

### Request

```
POST /v1/chat/completions
Content-Type: application/json
```

#### Body Parameters

| Parameter     | Type                      | Required | Default | Description                                         |
|---------------|---------------------------|----------|---------|-----------------------------------------------------|
| `model`       | `string`                  | Yes      | —       | Model identifier (e.g., `gpt-4o`, `claude-sonnet-4-20250514`, `gemini-2.0-flash`) |
| `messages`    | `Message[]`               | Yes      | —       | Array of messages (at least one)                    |
| `stream`      | `boolean`                 | No       | `false` | Enable Server-Sent Events streaming                 |
| `temperature` | `number`                  | No       | —       | Sampling temperature (0–2)                          |
| `max_tokens`  | `integer`                 | No       | —       | Maximum tokens in the response                      |
| `top_p`       | `number`                  | No       | —       | Nucleus sampling (0–1)                              |
| `stop`        | `string \| string[]`      | No       | —       | Stop sequence(s)                                    |

#### Message Object

| Field     | Type   | Required | Description                                  |
|-----------|--------|----------|----------------------------------------------|
| `role`    | `enum` | Yes      | One of: `system`, `user`, `assistant`        |
| `content` | `string` | Yes    | The message content                          |

### Response (Non-Streaming)

**Status:** `200 OK`

```json
{
  "id": "chatcmpl-abc123def456",
  "object": "chat.completion",
  "created": 1709251200,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 9,
    "total_tokens": 21
  }
}
```

### Response (Streaming)

**Status:** `200 OK`
**Content-Type:** `text/event-stream`

Each SSE event contains a `data` field with a JSON chunk:

```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1709251200,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1709251200,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1709251200,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### Examples

#### Basic Request

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "What is Kubernetes?"}
    ]
  }'
```

#### Streaming Request

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Explain Docker in one sentence."}
    ],
    "stream": true
  }'
```

#### Multi-Provider (Anthropic)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {"role": "user", "content": "Write a haiku about caching."}
    ],
    "temperature": 0.7,
    "max_tokens": 100
  }'
```

#### Smart Routing (Virtual Model)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-routing-strategy: cost" \
  -d '{
    "model": "smart-model",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

#### Skip Cache

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Skip-Cache: true" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "What time is it?"}
    ]
  }'
```

---

## GET /health

Lightweight health check. Returns `200` immediately — useful for load balancer probes.

### Response

**Status:** `200 OK`

```json
{
  "status": "ok",
  "timestamp": "2025-02-11T12:00:00.000Z",
  "uptime": 3600.5
}
```

---

## GET /ready

Readiness check — verifies the gateway and its dependencies are ready to serve traffic.

### Response

**Status:** `200 OK` (all healthy) or `503 Service Unavailable` (degraded)

```json
{
  "status": "ready",
  "checks": {
    "server": "ok",
    "redis": "ok"
  }
}
```

#### Degraded Example

```json
{
  "status": "degraded",
  "checks": {
    "server": "ok",
    "redis": "unavailable"
  }
}
```

---

## GET /metrics

Returns a detailed metrics snapshot including cache stats, cost tracking, and error tracking.

### Response

**Status:** `200 OK`

```json
{
  "totalRequests": 150,
  "startedAt": "2025-02-11T10:00:00.000Z",
  "cache": {
    "hits": 42,
    "misses": 98,
    "skips": 10,
    "errors": 0,
    "avgHitLatencyMs": 15,
    "avgMissLatencyMs": 120,
    "totalEmbeddingCalls": 98
  },
  "cost": {
    "totalCostUsd": 0.0523,
    "totalInputTokens": 15000,
    "totalOutputTokens": 8000,
    "byProvider": {
      "openai": { "requests": 80, "totalCost": 0.032, "inputTokens": 10000, "outputTokens": 5000 },
      "anthropic": { "requests": 50, "totalCost": 0.018, "inputTokens": 4000, "outputTokens": 2500 },
      "google": { "requests": 20, "totalCost": 0.0023, "inputTokens": 1000, "outputTokens": 500 }
    },
    "byModel": {
      "gpt-4o": { "requests": 50, "totalCost": 0.025 },
      "gpt-4o-mini": { "requests": 30, "totalCost": 0.007 }
    },
    "recentRequests": []
  },
  "errors": {
    "global": { "totalErrors": 3, "errorRate": 0.02 },
    "providers": {},
    "recentErrors": []
  }
}
```

---

## GET /metrics/costs

Dedicated cost tracking endpoint — detailed breakdown by provider and model.

### Response

**Status:** `200 OK`

```json
{
  "totalCostUsd": 0.0523,
  "totalInputTokens": 15000,
  "totalOutputTokens": 8000,
  "byProvider": {
    "openai": { "requests": 80, "totalCost": 0.032, "inputTokens": 10000, "outputTokens": 5000 },
    "anthropic": { "requests": 50, "totalCost": 0.018, "inputTokens": 4000, "outputTokens": 2500 },
    "google": { "requests": 20, "totalCost": 0.0023, "inputTokens": 1000, "outputTokens": 500 }
  },
  "byModel": {
    "gpt-4o": { "requests": 50, "totalCost": 0.025 },
    "claude-sonnet-4-20250514": { "requests": 50, "totalCost": 0.018 }
  },
  "recentRequests": [
    {
      "provider": "openai",
      "modelId": "gpt-4o",
      "inputTokens": 120,
      "outputTokens": 45,
      "costUsd": 0.00075,
      "timestamp": 1709251200000
    }
  ]
}
```

---

## GET /

Root endpoint — returns gateway info and available endpoints.

### Response

**Status:** `200 OK`

```json
{
  "name": "ai-gateway",
  "version": "0.1.0",
  "endpoints": [
    "/v1/chat/completions",
    "/health",
    "/ready",
    "/metrics",
    "/metrics/costs"
  ]
}
```

---

## Custom Headers

### Request Headers

| Header              | Type     | Description                                                          |
|---------------------|----------|----------------------------------------------------------------------|
| `X-Skip-Cache`      | `string` | Set to `"true"` to bypass the semantic cache for this request        |
| `x-routing-strategy` | `string` | Override the routing strategy: `cost`, `latency`, `balanced`, `capability` |

### Response Headers

| Header          | Type     | Description                                                              |
|-----------------|----------|--------------------------------------------------------------------------|
| `X-Cache`       | `string` | Cache status: `HIT`, `MISS`, `SKIP`, or `DISABLED`                      |
| `X-Cache-Score` | `string` | Cosine similarity score on cache hit (e.g., `0.0523`) — lower is better |

---

## Error Format

All errors follow the OpenAI error format:

```json
{
  "error": {
    "message": "Invalid request body",
    "type": "invalid_request_error",
    "code": "validation_error",
    "details": [...]
  }
}
```

### HTTP Status Codes

| Code | Meaning                | Description                                      |
|------|------------------------|--------------------------------------------------|
| 200  | OK                     | Successful request                               |
| 400  | Bad Request            | Invalid request body or missing required fields  |
| 404  | Not Found              | Unknown endpoint                                 |
| 429  | Too Many Requests      | Rate limit exceeded                              |
| 500  | Internal Server Error  | Provider error or gateway failure                |
| 503  | Service Unavailable    | Gateway or dependency not ready                  |

---

## Supported Models

### Direct Models

| Provider   | Model ID                       | Description            |
|------------|--------------------------------|------------------------|
| OpenAI     | `gpt-4o`                       | GPT-4o (latest)        |
| OpenAI     | `gpt-4o-mini`                  | GPT-4o Mini (fast)     |
| OpenAI     | `gpt-3.5-turbo`                | GPT-3.5 Turbo          |
| Anthropic  | `claude-sonnet-4-20250514`     | Claude Sonnet 4        |
| Anthropic  | `claude-3-5-haiku-20241022`    | Claude 3.5 Haiku       |
| Google     | `gemini-2.0-flash`             | Gemini 2.0 Flash       |
| Google     | `gemini-2.5-pro`               | Gemini 2.5 Pro         |
| Google     | `gemini-1.5-pro`               | Gemini 1.5 Pro         |
| Google     | `gemini-1.5-flash`             | Gemini 1.5 Flash       |

### Virtual Models (Smart Routing)

| Alias         | Primary                    | Fallback       | Use Case              |
|---------------|----------------------------|----------------|-----------------------|
| `smart-model` | `claude-sonnet-4-20250514` | `gpt-4o`       | Best quality          |
| `fast-model`  | `gpt-4o-mini`              | `gemini-2.0-flash` | Low latency / cost |

### Auto-Detection

The gateway automatically detects the provider from the model name prefix:

| Prefix              | Provider  |
|---------------------|-----------|
| `gpt-`, `o1-`, `o3-`, `chatgpt-` | OpenAI    |
| `claude-`           | Anthropic |
| `gemini-`           | Google    |
