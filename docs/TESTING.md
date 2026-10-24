# Testing

| Suite | Command | What it proves |
|---|---|---|
| Core unit + property tests | `pnpm --filter @justdownload/core test` | URL/SSRF rules (incl. fast-check fuzzing), safe fetch (rebinding, redirects into metadata, scheme changes, redirect caps), policy enforcement, state machine, option derivation (no resolution above source, exact sizes only for originals), FFmpeg argv, output validation, filenames (fuzzed), progress parsing, signatures |
| Worker unit | `pnpm --filter @justdownload/worker test` | config hardening, probe normalisation (cover art, partial durations), encoder detection, argv-only subprocesses + kill on timeout/abort, storage key safety, transitions |
| Worker integration | `pnpm --filter @justdownload/worker test:integration` (add `REDIS_URL` for the Redis/BullMQ suite) | Real FFmpeg/FFprobe: inspect → MP3/H.264 downscale/MKV remux/original → validated artifact → signed download (checksum + FFprobe on the downloaded bytes); signed single-use upload; policy denial; forged option ids; session isolation; idempotency; transient-failure retry; cancel mid-download with cleanup; crash recovery; expiry; delete; audio/video merge |
| Web unit | `pnpm --filter @justdownload/web test` | CSRF guard, rate limit, error schema |
| E2E (Playwright) | `cd apps/web && pnpm build && pnpm test:e2e` | Desktop + mobile (Pixel 7). Without a worker: invalid/unsafe URLs never hit the API, policy results, web pages rejected, basic inspection, keyboard-only flow + focus, theme persistence, sources table, no horizontal overflow. With `E2E_WORKER_URL`+`E2E_WORKER_TOKEN`: real MP3 job, reload restores state, browser download of a real MP3, cancel during download |

Suites that need something unavailable are **reported as skipped**, never as passed (Redis suite
without `REDIS_URL`, full E2E without a worker, web-only E2E when a worker is attached).

## Fixtures

All media fixtures are generated at test time by FFmpeg's synthetic sources (`testsrc2`, `sine`), so
they are project-created with no third-party rights. Nothing from real platforms is used, and no test
contacts an external website.

## Not covered yet

Load/performance tests, cross-browser runs beyond Chromium, and container egress tests. See
IMPLEMENTATION_PLAN.md.
