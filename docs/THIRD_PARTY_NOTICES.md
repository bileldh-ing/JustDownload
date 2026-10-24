# Third-party notices

## Runtime tools

- **FFmpeg / FFprobe** — the worker image installs Debian bookworm's `ffmpeg` package. Debian builds
  FFmpeg with GPL components enabled (e.g. libx264), which makes those binaries GPL-2.0-or-later.
  Verify the exact build with `docker run --rm --entrypoint ffmpeg justdownload-worker -version`
  (see the `configuration:` line) before redistributing the image, and comply with the GPL (offer the
  corresponding source; Debian publishes it). https://ffmpeg.org/legal.html
- **yt-dlp** — not included in this build (no extractor adapter ships). If added later: the repository
  is Unlicense, but bundled release executables include third-party code under other licences; review
  https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt for the artifact you ship.
- **Redis** — official `redis:7-alpine` image in docker-compose (not redistributed by this repo).

## Fonts

Plus Jakarta Sans (Tokotype) and JetBrains Mono (JetBrains), SIL Open Font License 1.1 —
`apps/web/src/app/fonts/LICENSE-FONTS.txt`.

## npm dependencies (direct)

next, react, react-dom (MIT) · tailwindcss, @tailwindcss/postcss (MIT) · lucide-react (ISC) ·
motion (MIT) · @radix-ui/react-dropdown-menu (MIT) · zod (MIT) · ipaddr.js (MIT) · fastify,
@fastify/cors (MIT) · bullmq (MIT) · ioredis (MIT) · pino (MIT) · Dev: typescript (Apache-2.0),
vitest (MIT), @playwright/test (Apache-2.0), eslint (MIT), typescript-eslint (MIT/BSD-2), esbuild (MIT),
tsx (MIT), fast-check (MIT).

Generate a full transitive licence report with `pnpm licenses list --prod`.
