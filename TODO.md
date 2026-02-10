# TODO — AI Gateway

## Phase 1: Local Development ✅
- [x] Initialize TypeScript project (Bun + Hono)
- [x] Create basic `/v1/chat/completions` endpoint (OpenAI-compatible)
- [x] Implement OpenAI provider adapter
- [x] Implement Anthropic provider adapter
- [x] Implement Google/Gemini provider adapter
- [x] Add basic routing logic (config-based + auto-detection)
- [x] Docker setup for local development
- [x] Streaming support (SSE with OpenAI-compatible format)
- [x] Request validation (Zod)
- [x] Logging middleware (Pino, GCP-compatible)
- [x] Error handling middleware (OpenAI error format)

## Phase 2: Semantic Cache ✅
- [x] Set up Redis client (node-redis) with connection management
- [x] Implement embedding generation for prompts
- [x] Create vector index in Redis Stack (HNSW, COSINE)
- [x] Implement cache lookup (KNN vector search)
- [x] Implement cache storage on response
- [x] Add cache hit/miss metrics
- [x] Configure TTL and similarity threshold
- [x] Add `X-Skip-Cache` header support
- [x] Wire cache as Hono middleware

## Phase 3: Smart Routing ✅
- [x] Define routing rules (cost, latency, model capability)
- [x] Implement model selector based on request metadata
- [x] Add fallback logic (retry with different provider on 5xx/429)
- [x] Add rate limiting per provider (token bucket)
- [x] Implement request timeout handling
- [x] Track provider latency for least-latency routing

## Phase 4: Observability
- [ ] Structured logging (request/response) — ✅ Partially done in Phase 1
- [ ] Cost tracking per request (input/output tokens × pricing)
- [ ] Latency metrics per provider
- [ ] Error tracking and alerting
- [ ] Simple dashboard endpoint (`/metrics`)
- [ ] OpenTelemetry integration (experimental)

## Phase 5: Kubernetes (GKE) ✅
- [x] Create Dockerfile (multi-stage build) — Done in Phase 1
- [x] Create K8s manifests:
  - [x] Namespace (`ai-gateway`)
  - [x] Deployment + Service (gateway)
  - [x] StatefulSet + Service (Redis Stack)
  - [x] ConfigMap (routing rules)
  - [x] Secret (API keys template)
  - [x] HPA (autoscaling)
  - [x] Network Policies
  - [x] Ingress / LoadBalancer
  - [x] Kustomization (ties all manifests together)
- [ ] Push images to Artifact Registry
- [ ] Deploy to GKE Autopilot
- [ ] Test with external LoadBalancer IP
- [x] Document deployment process

## Phase 6: Polish
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Health check endpoints (`/health`, `/ready`) — ✅ Done in Phase 1
- [ ] Graceful shutdown
- [ ] README with demo GIFs
- [ ] Blog post / project write-up
- [ ] Tests (unit + integration)
