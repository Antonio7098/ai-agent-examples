# Repo Analysis: langfuse

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js (Next.js web, Express worker, PostgreSQL, ClickHouse, Redis, S3/MinIO) |
| Analyzed | 2026-05-17 |

## Summary

Langfuse provides runtime isolation through Docker containerization. The web and worker services run as separate containers with non-root users, but there is no process-level sandbox, no seccomp/AppArmor profiles, no capability dropping, and no resource limits (CPU/memory) configured in Docker. Filesystem access is unrestricted within containers; network access is broad (S3, Redis, PostgreSQL, ClickHouse). The worker processes queue jobs from Redis but executes them in-process without sandboxing. Score: 4/10 — Basic container isolation but no sandboxing.

## Rating

4/10 — Basic container isolation but no sandboxing. Containers run with non-root users and minimal images, but no seccomp/AppArmor profiles, no capability restrictions, no resource limits, and no process-level sandboxing.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Docker web container | Multi-stage build, node:24-alpine, runtime-base stage | `web/Dockerfile:2-16` |
| Docker worker container | Multi-stage build, node:24-alpine, runtime-base stage | `worker/Dockerfile:2-16` |
| Non-root web | `adduser --system --uid 1001 nextjs`, `USER nextjs` | `web/Dockerfile:137-138,170` |
| Non-root worker | `adduser --system --uid 1001 expressjs`, `USER expressjs` | `worker/Dockerfile:84-87,92` |
| dumb-init entrypoint | Both services use `dumb-init` as PID 1 | `web/Dockerfile:177`, `worker/Dockerfile:99` |
| docker-compose service definitions | langfuse-web, langfuse-worker, clickhouse, redis, postgres, minio | `docker-compose.yml:7-177` |
| dev Docker compose | Same services with localhost binding for internal services | `docker-compose.dev.yml:1-120` |
| Build Docker compose | Same services without localhost binding | `docker-compose.build.yml:1-163` |
| No CPU/memory limits | No `--cpus`, `--memory` flags in any docker-compose service definition | `docker-compose.yml:7-177`, `docker-compose.build.yml:1-163` |
| No seccomp/AppArmor | No `security_opt` or `cap_drop` in any service definition | `docker-compose.yml:1-178` |
| Network isolation | Internal services bound to 127.0.0.1 in dev; exposed in prod build compose | `docker-compose.yml:19-20,102-103,139-140,163-164` |
| Redis auth | `--requirepass ${REDIS_AUTH}` with noeviction policy | `docker-compose.yml:136-138` |
| TLS for Redis | Optional TLS with configurable CA/cert/key paths | `packages/shared/src/server/redis/redis.ts:62-103` |
| ClickHouse user | Runs as non-root user `101:101` | `docker-compose.yml:93`, `docker-compose.build.yml:84` |
| Queue workers | BullMQ workers registered in WorkerManager, process queue jobs | `worker/src/queues/workerManager.ts:145-154` |
| Queue job execution | Jobs processed via BullMQ Worker without sandboxing | `worker/src/queues/workerManager.ts:48-109` |
| S3 access | Workers access S3/MinIO for event storage, media, batch exports | `worker/src/env.ts:41-61` |
| Filesystem read in scripts | Scripts use `fs.readFileSync` for local files (only in `/app` workspace) | `worker/src/scripts/refillQueueEvent/index.ts:67`, `worker/src/scripts/createDefaultModelPricesJson.ts:68` |
| No process cwd restriction | Scripts use `process.cwd()` which resolves to `/app` inside container | `worker/src/scripts/verifyClickhouseRecords/index.ts:251,266,279` |
| Node.js per-worker concurrency | BullMQ `concurrency` option per queue (see `worker/src/app.ts:390-420`) | `worker/src/app.ts:390-420` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?
Docker container isolation between services (web, worker, postgres, redis, clickhouse, minio). Each service is a separate container. The web and worker containers run Node.js processes; the worker processes queue jobs from Redis but executes them in-process without sandboxing. No seccomp/AppArmor profiles, no capability dropping, no namespace isolation beyond container boundaries.

### 2. How is code executed (direct, container, sandbox)?
Code is executed inside Docker containers (`langfuse-web`, `langfuse-worker`) via `node` process (web: Next.js server, worker: Express/BullMQ). Both containers use `dumb-init` as PID 1 (`web/Dockerfile:177`, `worker/Dockerfile:99`). Worker jobs are dispatched via BullMQ and processed by the same Node.js process — no child process or VM isolation per job. No WebWorker, no VM, no container-per-job isolation.

### 3. What filesystem access does the agent have?
Full filesystem access within the container. The web container runs as user `nextjs` (UID 1001) with access to `/app` working directory. The worker container runs as user `expressjs` (UID 1001). There are no explicit `readonly` root filesystems, no tmpfs restrictions, and no seccomp constraints. Scripts that need local file access (e.g., `refillQueueEvent`, `createDefaultModelPricesJson`) use `fs.readFileSync`/`fs.writeFileSync` freely within the container's filesystem. No evidence of chroot, pivot_root, or similar.

### 4. What network access does the agent have?
Broad network access. The worker accesses external S3 endpoints (configurable via `LANGFUSE_S3_*` env vars at `worker/src/env.ts:41-61`), Redis, PostgreSQL, ClickHouse, and can make outbound HTTP calls (e.g., webhooks). Services are exposed on ports 3000 (web), 3030 (worker), 6379 (redis), 5432 (postgres), 8123/9000 (clickhouse), 9090 (minio). In dev compose, internal services bind to `127.0.0.1` only (`docker-compose.yml:19-20,102-103,139-140,163-164`); in prod build compose they bind to all interfaces. No network policy or iptables restrictions within the cluster.

### 5. Can execution escape the sandbox?
No sandbox exists to escape. The "sandbox" is the Docker container boundary. Within a container, the process runs as a non-root user but has full access to the container's filesystem and network. Docker container escape would require a kernel exploit or privileged container misconfiguration — neither is present in the default configuration, but there is no explicit defense-in-depth.

### 6. How are side effects contained?
Side effects (queue jobs, database writes, S3 uploads) are contained by the service boundary — each service only touches its intended storage (Postgres, ClickHouse, Redis, S3). Queue job failures are logged and retried via BullMQ (`worker/src/queues/workerManager.ts:161-172`). There is no mechanism to rollback a failed job's partial side effects.

### 7. What are the trust boundaries?
- **Untrusted input**: User-provided LLM traces/events ingested via the ingestion API. Validated via Zod schemas before processing.
- **Internal services**: Postgres, Redis, ClickHouse, MinIO — accessed via authenticated connections (passwords via env vars).
- **External services**: S3-compatible storage — accessed via credentials in env vars.
- **Webhook/github dispatch**: Outbound HTTP calls to user-configured URLs (`worker/src/queues/webhooks.ts:106`). This is the most direct path for user-controlled side effects outside the system.
- **No trust boundary between web and worker**: Both share the same env configuration and can be considered equally trusted.

### 8. Are there resource limits?
No CPU or memory limits configured in Docker. Redis has `--maxmemory-policy noeviction` (`docker-compose.yml:138`) which limits Redis memory usage. ClickHouse has query-level memory limits (detected in error discriminators at `packages/shared/src/server/repositories/clickhouse.ts:36`). The Node.js process can consume unlimited memory and CPU within the container — Docker resource constraints (`--cpus`, `--memory`) are not set in any compose file.

## Architectural Decisions

- **dumb-init as PID 1**: Both containers use `dumb-init` to properly reap zombie processes and handle signals. This is a container best practice but does not provide security isolation.
- **Non-root users**: Web runs as `nextjs`, worker as `expressjs`. This prevents privilege escalation to root within the container.
- **Multi-stage builds**: Builds use multiple stages to minimize final image surface (runtime-base removes npm, corepack).
- **Separate web and worker containers**: The architecture separates request serving (web) from background processing (worker), which provides some fault isolation but both share the same container network and volumes.
- **BullMQ for job queuing**: Jobs are queued in Redis and processed by workers. Concurrency is configurable per queue but runs within the same Node.js process.

## Notable Patterns

- **Per-queue concurrency**: WorkerManager supports per-queue concurrency limits configured in `worker/src/app.ts:390-420` via BullMQ options.
- **Redis TLS**: Optional mutual TLS for Redis connections with configurable CA/cert/key paths.
- **Queue metrics**: Queue depth, processing time, and failure rates are instrumented via `WorkerManager.metricWrapper` at `worker/src/queues/workerManager.ts:41-110`.
- **Process shutdown handling**: Graceful shutdown via `shutdown.ts` that closes BullMQ workers and flushes pending writes.

## Tradeoffs

- **No process sandboxing**: Agent/LLM-generated code (if any) would run in the same Node.js process with full host access within the container. There is no VM, WebWorker, or separate process boundary per job.
- **No resource limits**: A runaway worker job can consume all container CPU/memory. Docker `--memory` and `--cpus` flags are not set.
- **Broad network access**: All containers share the same Docker network. A compromised worker could reach postgres, redis, clickhouse, and minio directly.
- **No filesystem readonly**: Container filesystems are writable. A compromised process could modify binaries or configuration.
- **Webhook dispatch is user-controlled outbound**: The webhook executor (`worker/src/queues/webhooks.ts`) calls user-configured URLs, which is an intentional design with risk of SSRF.

## Failure Modes / Edge Cases

- **Redis connection exhaustion**: If Redis becomes unavailable, queue jobs fail; BullMQ `retryStrategy` backs off exponentially (`packages/shared/src/server/redis/redis.ts:17-23`).
- **ClickHouse memory limits**: Queries that exceed ClickHouse memory limits throw `DB::Exception: memory limit exceeded` (`packages/shared/src/server/repositories/clickhouse.ts:36`).
- **Job failure with partial side effects**: A failed queue job may have written to Postgres/ClickHouse/S3 before failing. No transactional rollback mechanism.
- **Webhook SSRF**: User-controlled webhook URLs could be internal services (e.g., `http://redis:6379`) if the dispatcher doesn't validate URLs.
- **Unbounded concurrency**: If `LANGFUSE_QUEUE_CONCURRENCY` is set high without corresponding resource limits, worker can exhaust memory.

## Future Considerations

- Add Kubernetes security contexts with `readOnlyRootFilesystem: true`, `capDrop: ALL`, and `securityContext` for pods.
- Add Docker resource limits (`--memory`, `--cpus`) in docker-compose for self-hosted deployments.
- Consider running queue jobs in isolated processes (child_process with limited permissions or WebWorkers) for true job-level sandboxing.
- Add network policies to restrict inter-service communication (e.g., worker should not directly reach postgres, only via web service).
- Add URL validation to webhook dispatcher to prevent SSRF.

## Questions / Gaps

- **No seccomp/AppArmor profiles found**: No `security_opt` in any docker-compose service definition. This is a gap compared to hardened container deployments.
- **No explicit filesystem restrictions**: No `read_only` volumes, no tmpfs mounts for sensitive paths.
- **No capability dropping**: Containers run with default Docker capabilities. `CAP_SYS_ADMIN`, `CAP_NET_ADMIN`, etc. are not explicitly dropped.
- **Webhook URL validation**: Evidence shows webhook URLs are user-supplied (`worker/src/queues/webhooks.ts`) but URL validation scope is unclear from static analysis.
- **No evidence of gVisor, Kata Containers, or similar**: No mention of VM-based or hardware-assisted sandboxing for agent execution.

---

Generated by `study-areas/17-runtime-isolation.md` against `langfuse`.