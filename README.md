# JustDownload

Paste a media link or drop a file. JustDownload inspects the **real** streams with FFprobe, offers only
the formats that actually exist (or clearly labelled conversions), converts with FFmpeg, verifies the
output, and hands you the file through a short-lived private link.

It is **policy-aware**: platforms whose terms restrict downloading (YouTube, Facebook, Instagram,
TikTok, X, Vimeo, SoundCloud) are never scraped. They get an honest explanation and a link to their
official export feature. Direct media links, your own uploads and self-hosted/creator-authorised
files are first-class.

> There is no "download anything from anywhere" promise. What works is exactly what
> [Supported sources](docs/PROVIDER_POLICY.md) says.

## What's in the box

| | |
|---|---|
| `apps/web` | Next.js 16 app: Liquid Glass UI (blue accent, light/dark/system), `/api/v1` backend-for-frontend. Deployable to Vercel on its own (inspection-only mode). |
| `apps/worker` | Node worker: Fastify API + BullMQ consumers, FFprobe/FFmpeg pipeline, signed downloads/uploads, SSE progress, retention sweeper. Ships as a Docker image. |
| `packages/core` | Shared rules: provider policy registry, SSRF-safe fetch, job state machine, output options + FFmpeg argv builder, filename sanitising. |

### Live status of this deployment

- Web app: deployed on Vercel (see the repository description / deployment notes).
- **No processing worker is hosted yet.** The public site therefore runs in *inspection-only* mode:
  it validates links, applies the policy and checks what a URL serves (first 64 KB, no FFprobe),
  and it tells users that downloading and conversion need a worker. Nothing is faked.

## Quick start

```bash
pnpm install
cp .env.example .env              # set WORKER_API_TOKEN and SIGNING_SECRET
docker compose up --build         # web :3000, worker :8080, redis
```

Or without Docker (needs Node 22, pnpm 10, FFmpeg): `make dev-worker` and `make dev-web`.

## Commands

| | |
|---|---|
| `make lint` / `make typecheck` | ESLint, `tsc --noEmit` everywhere |
| `make test` | unit tests (core, worker, web) |
| `make integration-test` | real FFmpeg pipeline tests (add `REDIS_URL` for the BullMQ suite) |
| `make e2e` | Playwright (desktop + mobile); full-pipeline suite with `E2E_WORKER_URL` |
| `make build` | worker bundle + Next.js production build |

## Docs

[Implementation plan](docs/IMPLEMENTATION_PLAN.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Operations & deployment](docs/OPERATIONS.md) · [Security](docs/SECURITY.md) ·
[Provider policy](docs/PROVIDER_POLICY.md) · [Testing](docs/TESTING.md) ·
[Third-party notices](docs/THIRD_PARTY_NOTICES.md)

## Acceptable use

For media you own, are authorised to download, or that the source explicitly makes downloadable.
No DRM, paywall, login or private-account circumvention, no cookie import. A legal review is still
pending before any public commercial launch.
