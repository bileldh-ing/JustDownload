# Operations

## Components

| Component | Where | Notes |
|---|---|---|
| Web (Next.js) | Vercel, or `docker/web.Dockerfile` | Stateless. Without `WORKER_URL` it runs in inspection-only mode. |
| Worker API | `docker/worker.Dockerfile`, command `api` | Public HTTPS URL needed for signed downloads/uploads/SSE (`PUBLIC_URL`). |
| Worker consumers | same image, command `worker` | Needs the same `/data` volume as the API (uploads in, artifacts out). |
| Redis | any Redis ≥ 6.2 | Queue + metadata. Enable AOF persistence. |

Small deployments can run one container with command `all` (API + consumers) plus Redis.

## Environment variables

Worker: `REDIS_URL`, `WORKER_API_TOKEN` (≥24 chars), `SIGNING_SECRET` (≥32 chars), `PUBLIC_URL`,
`CORS_ORIGINS` (web origin), `DATA_DIR` (/data), `MAX_SOURCE_MB`, `MAX_UPLOAD_MB`, `MAX_DURATION_MIN`,
`RETENTION_MINUTES`, `INSPECTION_TTL_MIN`, `CONCURRENCY_VIDEO`, `CONCURRENCY_AUDIO`, `JOB_TIMEOUT_MIN`,
`JOB_ATTEMPTS`, `MAX_QUEUE_DEPTH`, `MAX_DISK_GB`, `RATE_LIMIT_PER_MIN`, `JD_PROVIDER_POLICY_OVERRIDES`,
`LOG_LEVEL`. The worker refuses to start in production without strong secrets, and refuses
`JD_ALLOW_PRIVATE_NETWORK=1` in production.

Web: `WORKER_URL` (server-to-server URL of the worker API), `WORKER_API_TOKEN` (same value),
`NEXT_PUBLIC_WORKER_PUBLIC_URL` (build time; added to CSP `connect-src`), `JD_PROVIDER_POLICY_OVERRIDES`
(same as worker), optional `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_REPORT_URL`, `RATE_LIMIT_PER_MIN`.

Secrets belong in the platform's secret manager; `.env.example` contains placeholders only.

## Local full stack

```bash
cp .env.example .env     # set WORKER_API_TOKEN and SIGNING_SECRET (openssl rand -base64 36)
docker compose up --build
# web http://localhost:3000 · worker http://localhost:8080
```

Without Docker: `make dev-worker` (in-memory queue when `REDIS_URL` is unset — development only) and
`make dev-web`.

## Deploying the web app to Vercel

Project root directory `apps/web` (its `vercel.json` installs from the monorepo root). With no
`WORKER_URL`, the site works in inspection-only mode and the UI says so. To connect a worker later:
set `WORKER_URL`, `WORKER_API_TOKEN`, `NEXT_PUBLIC_WORKER_PUBLIC_URL` and redeploy, and set the
worker's `CORS_ORIGINS` to the Vercel origin.

## Deploying the worker (not hosted yet — choose a host)

The worker needs a long-running container, FFmpeg (in the image), a persistent volume at `/data` and
Redis. Any container host works; platform specifics change, so check their current docs.

- **Render**: create a *Web Service* from this repo with *Docker* runtime, Dockerfile path
  `docker/worker.Dockerfile`, start command `all`; attach a persistent disk at `/data`; add a Render
  Key Value (Redis-compatible) instance and set `REDIS_URL`; set `PUBLIC_URL` to the service URL.
- **Railway**: deploy from the repo with variable `RAILWAY_DOCKERFILE_PATH=docker/worker.Dockerfile`;
  add a Redis service and reference its URL in `REDIS_URL`; add a volume mounted at `/data`.
- **Fly.io**: use `docker/fly.worker.toml` as a starting point (`fly launch --copy-config -c docker/fly.worker.toml`),
  create a volume (`fly volumes create jd_data`), provision Redis (e.g. Upstash via `fly redis create`),
  and `fly secrets set WORKER_API_TOKEN=… SIGNING_SECRET=… REDIS_URL=…`.

For separate API/consumer services, run two services from the same image (`api` and `worker`) that
share the volume — or use `all` on a single machine.

## Monitoring

- `GET /health/live` (process up), `GET /health/ready` (Redis reachable + FFmpeg/FFprobe present),
  `GET /v1/health` (Bearer token): tool versions, queue counts, limits.
- Logs are JSON (pino) with `request_id`, `job_id`, `provider`, `stage`, `error_code`; URLs are never
  logged with query strings.
- Failed BullMQ jobs are retained 7 days (`removeOnFail`) for inspection with any BullMQ UI.

## Runbooks

- **Queue backing up** (`queue.waiting` growing): raise `CONCURRENCY_*` if CPU allows, add worker
  replicas (same Redis + shared volume), or lower `MAX_QUEUE_DEPTH` so users get a clear 503.
- **Disk full**: the sweeper runs every minute; lower `RETENTION_MINUTES`; `MAX_DISK_GB` makes new jobs
  fail fast with `CAPACITY_EXCEEDED`. Orphaned dirs under `/data/work` older than 2× job timeout are removed.
- **FFmpeg missing**: `/health/ready` returns 503 and the web shows "Worker at capacity/unreachable".
  Rebuild the image.
- **Repeated failures**: check logs by `error_code`. `SOURCE_*` codes are the source's fault;
  `CONVERSION_FAILED`/`OUTPUT_VALIDATION_FAILED` need the (redacted) FFmpeg stderr tail in the warn log.
- **Draining for deploy**: send SIGTERM; the API stops accepting, consumers finish the current attempt
  (`stop_grace_period: 60s` in compose). Interrupted jobs are retried by BullMQ's stalled-job recovery.
- **Updating FFmpeg**: rebuild the image (Debian security updates), run the integration suite against
  it, roll out, roll back by redeploying the previous image tag.

## Backups

Redis holds only short-lived metadata; losing it loses in-flight guest jobs, nothing else. Artifacts
are temporary by design and are not backed up.

## Cost note

Software is free/open source, but bandwidth, CPU, storage and egress are not. Size concurrency and
limits to your budget; there is no "unlimited" mode.
