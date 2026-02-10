# AI Gateway

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3-black?logo=bun&logoColor=white)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

**Intelligent LLM Router** with semantic caching, multi-provider failover, and cost tracking.

A single OpenAI-compatible API that routes to **OpenAI**, **Anthropic**, and **Google** — with automatic retries, smart model selection, and Redis-powered semantic caching to reduce costs by up to 40%.

---

## What It Does

- **Multi-Provider Routing** — One API, three providers. Send requests to GPT-4o, Claude, or Gemini through a single endpoint.
- **Semantic Cache** — Redis vector search caches responses by meaning, not exact match. Similar questions return instant cached responses.
- **Smart Routing** — Rules engine scores providers by cost (30%), latency (40%), and capability (30%) to pick the optimal model.
- **Automatic Failover** — If a provider returns 5xx or 429, the gateway retries with exponential backoff and falls back to the next provider.
- **Rate Limiting** — Per-provider token bucket rate limiting to stay within API quotas.
- **Cost Tracking** — Real-time cost calculation per request with tiered alerts ($10, $50, $100, $500).
- **Error Tracking** — Per-provider error rates, circuit breaker pattern, and health monitoring.
- **OpenTelemetry Tracing** — Distributed tracing with OTLP export for Jaeger, Grafana Tempo, or any OTel collector.
- **OpenAI-Compatible** — Drop-in replacement for the OpenAI Chat Completions API (streaming + non-streaming).

---

## Architecture

```
                         ┌──────────────────────────────────────────────┐
                         │              AI Gateway (Hono)               │
                         │                                              │
  ┌──────────┐           │  ┌────────┐  ┌────────┐  ┌───────────────┐  │  ┌──────────┐
  │  Client   │──────────▶│  │Tracing │─▶│Logging │─▶│  Rate Limiter │  │  │  OpenAI  │
  │ (curl,    │           │  └────────┘  └────────┘  └───────┬───────┘  │  └──────────┘
  │  SDK,     │           │                                  │          │
  │  app)     │           │  ┌────────┐  ┌────────┐  ┌───────▼───────┐  │  ┌──────────┐
  │           │◀──────────│  │  Cost  │◀─│ Cache  │◀─│ Smart Router  │──│─▶│Anthropic │
  └──────────┘           │  │Tracking│  │ Store  │  │ (rules engine)│  │  └──────────┘
                         │  └────────┘  └────────┘  └───────┬───────┘  │
                         │                                  │          │  ┌──────────┐
                         │              ┌───────────────────▼┐         │  │  Google   │
                         │              │  Semantic Cache    │         │──▶│ (Gemini) │
                         │              │  (Redis + HNSW)    │         │  └──────────┘
                         │              └────────────────────┘         │
                         └──────────────────────────────────────────────┘
```

### Request Pipeline

```
Request → Tracing → Logging → Rate Limit → Timeout → Smart Router → Semantic Cache → LLM Call
                                                                                        ↓
Response ← Cost Tracking ← Cache Store ← Stream/Response ← Provider Adapter ← LLM Response
```

---

## Tech Stack

| Technology | Purpose | Why |
|---|---|---|
| **TypeScript** | Language | Type safety with Zod runtime validation |
| **Bun** | Runtime | Fast startup, native TypeScript, built-in test runner |
| **Hono** | Web Framework | Lightweight, middleware-oriented, edge-ready |
| **Vercel AI SDK** | LLM Abstraction | Multi-provider support, streaming, unified API |
| **Redis Stack** | Semantic Cache | RediSearch for HNSW vector similarity search |
| **OpenTelemetry** | Observability | Distributed tracing with OTLP export |
| **Pino** | Logging | Fast structured JSON logging (GCP-compatible) |
| **Zod** | Validation | Schema validation for requests and env vars |
| **Docker** | Containerization | Multi-stage build, non-root user |
| **GKE Autopilot** | Orchestration | Zero node management Kubernetes |

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.3+
- [Docker](https://docs.docker.com/get-docker/) (for Redis)
- At least one LLM API key (OpenAI required for embeddings)

### Local Development

```bash
# Clone
git clone https://github.com/CarlosPProjects/ai-gateway.git
cd ai-gateway

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start Redis Stack
docker compose up -d redis

# Start the gateway (with hot reload)
bun run dev
```

### Docker Compose (Full Stack)

```bash
# Start gateway + Redis together
docker compose up -d

# Check health
curl http://localhost:3000/health
```

---

## API Usage

### Basic Chat Completion

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "What is Kubernetes?"}]
  }'
```

### Streaming

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Explain Docker."}],
    "stream": true
  }'
```

### Smart Routing (Auto-Select Provider)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-routing-strategy: cost" \
  -d '{
    "model": "smart-model",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Skip Cache

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Skip-Cache: true" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "What time is it?"}]
  }'
```

### Check Metrics

```bash
# Health check
curl http://localhost:3000/health

# Detailed metrics (cache stats, cost, errors)
curl http://localhost:3000/metrics

# Cost breakdown by provider and model
curl http://localhost:3000/metrics/costs
```

> For full API documentation, see [docs/API.md](./docs/API.md).

---

## Configuration

All configuration is via environment variables. See [`.env.example`](./.env.example) for the complete reference.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `OPENAI_API_KEY` | — | **Required.** OpenAI API key (also used for embeddings) |
| `ANTHROPIC_API_KEY` | — | Optional. Enables Claude models |
| `GOOGLE_API_KEY` | — | Optional. Enables Gemini models |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `CACHE_ENABLED` | `true` | Enable/disable semantic caching |
| `CACHE_SIMILARITY_THRESHOLD` | `0.15` | Cosine distance threshold (lower = stricter) |
| `ROUTING_STRATEGY` | `balanced` | Default routing: `cost`, `latency`, `balanced`, `capability` |
| `RATE_LIMIT_ENABLED` | `true` | Enable/disable rate limiting |
| `OTEL_ENABLED` | `false` | Enable OpenTelemetry tracing |

---

## Project Structure

```
ai-gateway/
├── src/
│   ├── index.ts                 # Entry point — Hono app, middleware chain, graceful shutdown
│   ├── config/
│   │   ├── env.ts               # Zod-validated environment variables
│   │   ├── cache.ts             # Cache configuration
│   │   ├── pricing.ts           # Model pricing table (USD per 1K tokens)
│   │   ├── providers.ts         # Provider SDK instances (lazy init)
│   │   ├── routes.ts            # Static route config (model aliases + fallbacks)
│   │   └── routing-config.ts    # Routing rules (strategy, retries, backoff)
│   ├── middleware/
│   │   ├── cache.ts             # Semantic cache lookup + async store
│   │   ├── error-handler.ts     # Global error normalizer (OpenAI format)
│   │   ├── logging.ts           # Pino structured logging
│   │   ├── rate-limiter.ts      # Per-provider token bucket
│   │   ├── smart-router.ts      # Smart routing middleware
│   │   ├── timeout.ts           # Per-provider request timeouts
│   │   └── tracing.ts           # OpenTelemetry request tracing
│   ├── metrics/
│   │   ├── aggregator.ts        # Percentile + EMA calculations
│   │   └── latency-tracker.ts   # Per-provider latency tracking
│   ├── routes/
│   │   ├── chat.ts              # POST /v1/chat/completions
│   │   └── health.ts            # GET /health, /ready, /metrics, /metrics/costs
│   ├── routing/
│   │   ├── fallback-handler.ts  # Retry + provider failover
│   │   ├── model-selector.ts    # Top-level routing orchestrator
│   │   ├── provider-registry.ts # Provider health + circuit breaker
│   │   ├── retry-strategy.ts    # Exponential backoff
│   │   ├── rule-evaluator.ts    # Cost/latency/capability scoring
│   │   └── rules-engine.ts      # Multi-criteria ranking
│   ├── services/
│   │   ├── cache/
│   │   │   ├── embeddings.ts    # OpenAI embedding generation
│   │   │   ├── index-setup.ts   # Redis HNSW vector index
│   │   │   ├── redis.ts         # Redis client singleton
│   │   │   └── semantic-cache.ts# KNN vector search + cache store
│   │   ├── cost-tracker.ts      # Per-request cost calculation + alerts
│   │   ├── error-tracker.ts     # Per-provider error tracking
│   │   ├── metrics.ts           # In-memory metrics aggregation
│   │   ├── providers/
│   │   │   ├── index.ts         # Model factory + auto-detection
│   │   │   ├── openai.ts        # OpenAI adapter
│   │   │   ├── anthropic.ts     # Anthropic adapter
│   │   │   └── google.ts        # Google adapter
│   │   └── router/
│   │       └── index.ts         # Static route resolution
│   ├── telemetry/
│   │   └── setup.ts             # OpenTelemetry initialization
│   ├── types/                   # Shared TypeScript types (Zod schemas)
│   └── utils/
│       └── token-bucket.ts      # Token bucket rate limiter
├── tests/
│   ├── health.test.ts           # Health endpoint tests
│   ├── chat.test.ts             # Request validation tests
│   ├── cost-tracker.test.ts     # Cost calculation unit tests
│   └── error-tracker.test.ts    # Error recording unit tests
├── k8s/                         # Kubernetes manifests (GKE Autopilot)
├── docs/
│   ├── API.md                   # Full API reference
│   └── research/                # Architecture research & decisions
├── Dockerfile                   # Multi-stage production build
├── docker-compose.yaml          # Local development (gateway + Redis)
├── biome.json                   # Biome linter/formatter config
├── tsconfig.json                # TypeScript strict mode config
└── package.json
```

---

## Performance Characteristics

| Metric | Value |
|---|---|
| **Startup time** | ~50ms (Bun cold start) |
| **Cache hit latency** | ~15ms (Redis KNN search) |
| **Cache miss overhead** | ~120ms (embedding generation) |
| **Memory footprint** | ~30MB base (Bun + Hono) |
| **Concurrent connections** | Limited by Bun runtime (thousands) |
| **Rate limit algorithm** | Token bucket (per-provider, configurable) |

---

## Deployment

### Docker

```bash
docker build -t ai-gateway .
docker run -p 3000:3000 --env-file .env ai-gateway
```

### Kubernetes (GKE Autopilot)

Full Kubernetes manifests are in `k8s/` with Kustomize support:

```bash
# Build and push image
docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/ai-gateway/ai-gateway:latest .
docker push $REGION-docker.pkg.dev/$PROJECT_ID/ai-gateway/ai-gateway:latest

# Deploy
kubectl apply -k k8s/
```

Includes: Deployment with HPA (2-10 replicas), Redis StatefulSet with persistent storage, NetworkPolicies, health probes, and LoadBalancer ingress.

> See the [K8s deployment research](./docs/research/k8s-deployment.md) for the full guide.

---

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/cost-tracker.test.ts

# Type check
bunx tsc --noEmit

# Lint + format
bunx biome check --write .
```

---

## License

[MIT](./LICENSE)

---

Built by [Carlos Garavito](https://github.com/CarlosPProjects)
