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
│   ├── namespace.yaml        # ai-gateway namespace
│   ├── gateway-deployment.yaml # Gateway Deployment (2 replicas)
│   ├── gateway-service.yaml  # ClusterIP Service (80 → 3000)
│   ├── redis-statefulset.yaml # Redis Stack StatefulSet
│   ├── redis-service.yaml    # Headless Service for Redis
│   ├── configmap.yaml        # Non-secret config
│   ├── secret.yaml           # API keys (template)
│   ├── hpa.yaml              # Autoscaling (2–10 pods)
│   ├── network-policy.yaml   # Network isolation rules
│   ├── ingress.yaml          # External LoadBalancer
│   └── kustomization.yaml    # Kustomize entrypoint
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

## ☸️ Deploying to GKE Autopilot

### Prerequisites

- [Google Cloud SDK (`gcloud`)](https://cloud.google.com/sdk/docs/install) configured with a project
- [`kubectl`](https://kubernetes.io/docs/tasks/tools/) installed
- [Docker](https://docs.docker.com/get-docker/) installed
- A GCP project with billing enabled and the following APIs enabled:
  - Kubernetes Engine API
  - Artifact Registry API

### 1. Create GKE Autopilot Cluster

```bash
# Set your project
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1

gcloud config set project $PROJECT_ID

# Create cluster (if not already created)
gcloud container clusters create-auto ai-gateway-cluster \
  --region=$REGION

# Get credentials
gcloud container clusters get-credentials ai-gateway-cluster \
  --region=$REGION
```

### 2. Create Artifact Registry Repository

```bash
# Create Docker repository
gcloud artifacts repositories create ai-gateway \
  --repository-format=docker \
  --location=$REGION \
  --description="AI Gateway container images"

# Configure Docker auth
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

### 3. Build & Push Image

```bash
# Build the image
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/ai-gateway/ai-gateway:latest .

# Push to Artifact Registry
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/ai-gateway/ai-gateway:latest
```

### 4. Configure Secrets

```bash
# Create the secret with real API keys (do NOT commit these!)
kubectl create namespace ai-gateway

kubectl create secret generic gateway-secrets \
  --namespace=ai-gateway \
  --from-literal=OPENAI_API_KEY=sk-... \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-... \
  --from-literal=GOOGLE_API_KEY=AIza... \
  --from-literal=OPENAI_EMBEDDING_API_KEY=sk-...
```

### 5. Deploy with Kustomize

```bash
# Update the image reference to your actual registry
cd k8s
kustomize edit set image \
  REGION-docker.pkg.dev/PROJECT_ID/ai-gateway/ai-gateway=${REGION}-docker.pkg.dev/${PROJECT_ID}/ai-gateway/ai-gateway:latest

# Apply all manifests (skip secret.yaml since we created it manually above)
kubectl apply -k .
```

### 6. Verify Deployment

```bash
# Check pods are running
kubectl get pods -n ai-gateway

# Check services
kubectl get svc -n ai-gateway

# Get the external IP (may take a minute for LoadBalancer)
kubectl get svc ai-gateway-lb -n ai-gateway -w

# Test the health endpoint
export GATEWAY_IP=$(kubectl get svc ai-gateway-lb -n ai-gateway -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl http://$GATEWAY_IP/health

# Test a chat completion
curl -X POST http://$GATEWAY_IP/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'
```

### Kubernetes Manifests Overview

All manifests live in `k8s/` and are managed via [Kustomize](https://kustomize.io/):

| File | Resource | Description |
|------|----------|-------------|
| `namespace.yaml` | Namespace | `ai-gateway` namespace |
| `configmap.yaml` | ConfigMap | Non-secret config (Redis URL, cache settings, routing) |
| `secret.yaml` | Secret | API keys template (use `kubectl create secret` for real values) |
| `gateway-deployment.yaml` | Deployment | Gateway pods (2 replicas, probes, security context) |
| `gateway-service.yaml` | Service | ClusterIP service (port 80 → 3000) |
| `redis-statefulset.yaml` | StatefulSet | Redis Stack with persistent storage |
| `redis-service.yaml` | Service | Headless service for stable Redis DNS |
| `hpa.yaml` | HPA | Autoscale 2–10 replicas at 70% CPU |
| `network-policy.yaml` | NetworkPolicy | Gateway ↔ Redis isolation, Redis locked down |
| `ingress.yaml` | Service (LB) | External LoadBalancer for public access |
| `kustomization.yaml` | Kustomize | Ties all resources together |

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
