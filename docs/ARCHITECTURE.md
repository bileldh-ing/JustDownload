# Architecture

```
browser ──► web (Next.js, Vercel or Docker)                     worker (Docker: Node + FFmpeg)
             ├─ pages: /, /jobs/[id], /sources, /how-it-works, /privacy
             └─ /api/v1/* (BFF) ── Bearer WORKER_API_TOKEN ──►  API  (Fastify, /v1/*)
                                   + x-jd-session (guest)        ├─ inspections (FFprobe)
browser ─── signed URLs (download / upload / SSE) ────────────►  ├─ jobs, cancel, delete
                                                                 └─ signed: download, upload, events
                                                               consumers (BullMQ)
                                                                 video_download / audio_conversion
                                                               Redis: queue + job/inspection metadata
                                                               /data: inspections, uploads, work, artifacts
```

## Packages

- `packages/core` — shared, framework-free domain code:
  `providers.ts` (policy registry), `url-safety.ts` (normalisation + IP classification),
  `node/safe-fetch.ts` (DNS-pinned, redirect-validating HTTP client), `jobs.ts` (state machine),
  `media.ts` (output options, FFmpeg argument builder, output validation), `filename.ts`,
  `sniff.ts` (container magic bytes), `progress.ts`, `errors.ts` (error catalogue), `api.ts` (schemas).
- `apps/worker` — `inspect.ts`, `pipeline.ts` (job state machine executor), `service.ts`
  (create/cancel/delete), `server.ts` (HTTP API), `queue.ts` (BullMQ + in-process), `store.ts`
  (Redis + memory), `storage.ts`, `cleanup.ts`, `probe.ts`, `process.ts` (argv-only subprocesses).
- `apps/web` — UI and BFF routes. Without `WORKER_URL` it runs in inspection-only mode using
  `basicInspect` from core (64 KB range probe, no FFprobe).

## Request flow

1. `POST /api/v1/inspections {url}` → web checks origin + rate limit, sets the `jd_sid` cookie, then
   either forwards to the worker or runs the basic probe.
2. Worker: `normalizeUrl` → `resolveProvider` (policy) → if not permitted, return a policy view with no
   network request. Otherwise fetch up to 8 MB with a Range request through `safeFetch`, sniff, FFprobe.
   If the head isn't parseable and the file is ≤ 64 MB, fetch the whole file once and cache it.
3. `POST /api/v1/jobs {inspection_id, option_id, filename, idempotency_key}` → worker re-derives options
   from the stored probe, re-checks policy, validates the filename, claims the idempotency key, checks
   capacity, pins the cached source, persists the job (`created → validating → queued`), enqueues.
4. Consumer: fresh work dir per attempt → acquire (download with byte progress) → full re-probe and
   option re-resolution → FFmpeg (or original copy) with `-progress` parsing → FFprobe validation →
   SHA-256 → move to storage → `ready` with manifest. Always cleans the work dir.
5. Browser polls `GET /api/v1/jobs/:id` (or SSE on the worker); when `ready`, it receives a 10-minute
   signed download URL to the worker.

## Job states

`created → validating → (inspecting) → queued → downloading → (merging) → converting → validating_output → ready → expired`,
terminal alternatives `failed`, `cancelled`, `rejected_by_policy`. `queued → queued` is a retry. A job
found mid-stage at the start of an attempt (worker crash) is moved back to `queued` first. Illegal
transitions throw.

## Why Redis for metadata (not Postgres) in this milestone

Guest jobs live for minutes to hours, there are no users, and the queue already needs Redis. Redis with
AOF gives durability across restarts, atomic idempotency keys (`SET NX PX`), optimistic concurrency
(`WATCH`/`MULTI`) and pub/sub for SSE. When accounts, history or audit trails are added, introduce
Postgres for those entities and keep Redis for the queue.
