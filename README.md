# 🔀 AI Gateway

> Intelligent LLM Router with semantic caching, deployed on GKE Autopilot.

A production-ready AI Gateway that routes requests to multiple LLM providers, implements semantic caching, and provides observability. Built as a learning project for GKE/K8s while applying AI Engineering skills.

## 🎯 What It Does

- **Smart Routing**: Routes requests to optimal model based on cost/latency/task
- **Semantic Cache**: Cache similar prompts using embeddings (save $$$)
- **Multi-Provider**: OpenAI, Gemini, Anthropic, Groq, etc.
- **Observability**: Logs, metrics, cost tracking per request
- **Rate Limiting**: Protect against abuse
- **Fallbacks**: Auto-retry with different provider on failure

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│  AI Gateway  │────▶│  LLM APIs    │
│              │     │  (TypeScript)│     │ (OpenAI,     │
│              │◀────│              │◀────│  Gemini...)  │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                     ┌──────▼──────┐
                     │   Redis     │
                     │ (semantic   │
                     │   cache)    │
                     └─────────────┘
```

### K8s Architecture (GKE Autopilot)

```
┌─────────────────────────────────────────────────────┐
│                    GKE Autopilot                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Gateway    │  │  Gateway    │  │   Redis     │ │
│  │  Pod (HPA)  │  │  Pod (HPA)  │  │ StatefulSet │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │        │
│         └────────────────┼────────────────┘        │
│                          │                         │
│                   ┌──────▼──────┐                  │
│                   │ LoadBalancer│                  │
│                   │  (ingress)  │                  │
│                   └─────────────┘                  │
└─────────────────────────────────────────────────────┘
```

## 🛠️ Tech Stack

### Backend
| Technology | Purpose | Why |
|------------|---------|-----|
| **TypeScript** | Language | Type safety, your comfort zone |
| **Bun** | Runtime | Fast, built-in TypeScript, good DX |
| **Hono** | Framework | Lightweight, edge-ready, fast |
| **Vercel AI SDK** | LLM abstraction | Multi-provider support, streaming |

### Infrastructure
| Technology | Purpose | Why |
|------------|---------|-----|
| **Redis** | Cache + Vectors | Simple, fast, RediSearch for similarity |
| **Docker** | Containerization | Standard |
| **GKE Autopilot** | Orchestration | Learning goal, zero node management |
| **Artifact Registry** | Image storage | GCP native, secure |

### Observability
| Technology | Purpose | Why |
|------------|---------|-----|
| **Pino** | Logging | Fast, structured JSON logs |
| **OpenTelemetry** | Metrics/Tracing | Standard, optional |

## 📁 Project Structure

```
ai-gateway/
├── src/
│   ├── index.ts              # Entry point
│   ├── routes/
│   │   ├── chat.ts           # /v1/chat/completions
│   │   ├── health.ts         # /health, /ready
│   │   └── metrics.ts        # /metrics
│   ├── services/
│   │   ├── router/
│   │   │   ├── index.ts      # Model selection logic
│   │   │   └── rules.ts      # Routing rules config
│   │   ├── cache/
│   │   │   ├── index.ts      # Cache interface
│   │   │   ├── embeddings.ts # Generate embeddings
│   │   │   └── redis.ts      # Redis client
│   │   └── providers/
│   │       ├── index.ts      # Provider interface
│   │       ├── openai.ts     # OpenAI adapter
│   │       ├── gemini.ts     # Gemini adapter
│   │       └── anthropic.ts  # Anthropic adapter
│   └── middleware/
│       ├── logging.ts        # Request logging
│       └── rateLimit.ts      # Rate limiting
├── k8s/
│   ├── namespace.yaml
│   ├── gateway.yaml          # Deployment + Service
│   ├── redis.yaml            # StatefulSet + Service
│   ├── configmap.yaml        # Routing config
│   ├── secret.yaml           # API keys (template)
│   └── hpa.yaml              # Autoscaling
├── tests/
│   └── ...
├── Dockerfile
├── docker-compose.yaml       # Local dev (gateway + redis)
├── package.json
├── tsconfig.json
└── README.md
```

## 🔑 Prerequisites

### API Keys Needed
- [ ] OpenAI API Key (`OPENAI_API_KEY`)
- [ ] Google AI API Key (`GOOGLE_API_KEY`) - for Gemini
- [ ] (Optional) Anthropic API Key (`ANTHROPIC_API_KEY`)
- [ ] (Optional) Groq API Key (`GROQ_API_KEY`)

### Tools
- [ ] Bun installed (`curl -fsSL https://bun.sh/install | bash`)
- [ ] Docker Desktop
- [ ] `gcloud` CLI configured
- [ ] `kubectl` installed
- [ ] GCP Project with billing enabled

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/CarlosPProjects/ai-gateway.git
cd ai-gateway

# Install dependencies
bun install

# Copy env file
cp .env.example .env
# Edit .env with your API keys

# Start Redis (local)
docker-compose up -d redis

# Run dev server
bun run dev

# Test
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## 📚 Learning Goals

This project teaches:

### Kubernetes / GKE
- [x] Deployments and ReplicaSets
- [x] Services (ClusterIP vs LoadBalancer)
- [x] StatefulSets (for Redis)
- [x] ConfigMaps and Secrets
- [x] Horizontal Pod Autoscaler (HPA)
- [x] GKE Autopilot specifics
- [x] Artifact Registry workflow

### AI Engineering
- [x] Multi-provider LLM abstraction
- [x] Semantic caching with embeddings
- [x] Cost optimization strategies
- [x] Production patterns for AI services

## 🔗 Resources

- [Hono Documentation](https://hono.dev/)
- [Vercel AI SDK](https://sdk.vercel.ai/)
- [GKE Autopilot Guide](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview)
- [LiteLLM](https://github.com/BerriAI/litellm) - Inspiration
- [Portkey](https://portkey.ai/) - Inspiration

## 📄 License

MIT

---

Built by [Carlos Garavito](https://github.com/CarlosPProjects) as a Master's Cloud Computing project.
