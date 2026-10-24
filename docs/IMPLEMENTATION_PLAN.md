# JustDownload — implementation plan and repository findings

## 1. Repository audit (baseline, 2026-10-24)

- `github.com/bileldh-ing/JustDownload` was **empty** (no commits, no branches). There was no existing
  framework, design system, tests, CI or deployment config to preserve, so the project was scaffolded
  from scratch. Baseline test/lint/build results: none (nothing to run).
- Design reference: the owner's PinFlow Studio project (Next.js + Tailwind v4 "Warm Liquid Glass").
  Its token structure, glass layers, floating pill top bar, icon rail with an active accent circle,
  overview cards and mono status bar were reused, with the orange accent replaced by blue
  (`#2F7BFF` family) and a matching light theme.

## 2. Architecture decisions (and deviations from the master prompt)

| Topic | Master prompt suggestion | Chosen | Why |
|---|---|---|---|
| Web | Next.js App Router, strict TS | Same (Next 16, React 19, Tailwind 4, Lucide, Motion, Radix) | — |
| API | FastAPI (Python) | **Node/TypeScript** worker API (Fastify) + Next.js route handlers as a thin BFF | One language end-to-end; the policy registry, SSRF guard, state machine, option builder and FFmpeg argument builder live in one shared package (`packages/core`) used by both the web app and the worker, so the rules can't drift. The owner asked for a Node or Python worker. |
| Queue | Celery + Redis | **BullMQ + Redis** | Node-native equivalent: durable jobs, retries with exponential backoff + jitter, lock renewal and stalled-job recovery, per-queue concurrency, failed-job retention. |
| Database | PostgreSQL | **Redis (AOF persistence) for job/inspection metadata** | Jobs are short-lived guest jobs with TTLs; there are no accounts or history. Redis already backs the queue, keeps the deployment small, and supports atomic idempotency keys and optimistic-concurrency updates (WATCH/MULTI). Postgres is the documented upgrade path when accounts/history/audit are added. |
| Storage | Local + S3 | `ArtifactStorage` interface with **local filesystem** implementation | S3-compatible adapter not included yet (interface is ready). |
| Extractors | yt-dlp behind policy | **No extractor adapter shipped** | No platform is permitted by the default policy, so shipping yt-dlp would be dead weight. If an operator enables a platform in policy, inspection refuses with `PROVIDER_UNAVAILABLE` instead of scraping. See PROVIDER_POLICY.md. |
| Progress | SSE + polling | SSE endpoint on the worker (signed URL) + polling via the web API | Vercel functions can't hold long SSE connections; the browser connects to the worker directly when it's public. |
| Hosting | — | Web on Vercel; worker as a Docker image for Render/Railway/Fly | Vercel serverless can't run long FFmpeg jobs. The web app runs alone in **inspection-only mode** and says so in the UI. |

## 3. Milestones and acceptance criteria

1. **Policy + safety core** — provider registry, URL normalisation/SSRF classification, safe fetch with
   DNS pinning and redirect re-validation, filename sanitisation, state machine. *Accepted:* unit +
   property-based tests (fast-check) pass; restricted platforms are denied server-side.
2. **Vertical slice** — direct URL → FFprobe inspection → queued job → FFmpeg MP3 → FFprobe
   validation → signed download. *Accepted:* integration test downloads a real, validated MP3 (no mocks).
3. **Durable queue + job API** — Redis store, BullMQ, idempotency, retries, cancellation, recovery,
   retention sweeper. *Accepted:* integration tests for retry, cancel, crash recovery, expiry, Redis path.
4. **Frontend workflow** — all URL states, preview, option picker, processing/ready/failure views,
   local upload. *Accepted:* Playwright suite (desktop + mobile) passes with and without a worker.
5. **Design system** — Liquid Glass tokens, blue accent, light/dark/system theme, reduced motion,
   reduced transparency, focus states. *Accepted:* screenshots + keyboard/a11y e2e checks.
6. **Ops** — Dockerfiles (non-root), docker-compose, CI (lint, typecheck, unit, integration, e2e,
   docker build + smoke, audit, image scan, secret scan), docs.

## 4. Risks and open items

- **Legal review (TODO):** policy entries and the acceptable-use text have not been reviewed by a
  qualified lawyer. Required before any public commercial launch.
- No S3 adapter, no accounts/history, no admin panel (not linked or faked in the UI).
- Rate limiting is per process (web: per serverless instance). Add edge/WAF limits for public use.
- Worker egress firewalling is a deployment concern (see SECURITY.md); the app-level SSRF guard is
  the primary control.
- Licence for the repository itself has not been chosen by the owner yet.
