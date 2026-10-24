# JustDownload web app (Next.js standalone). No FFmpeg or yt-dlp in this image.
# Build from the repository root:  docker build -f docker/web.Dockerfile -t justdownload-web .
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
# Public worker URL is baked into the CSP connect-src at build time (uploads + progress events).
ARG NEXT_PUBLIC_WORKER_PUBLIC_URL=""
ENV NEXT_PUBLIC_WORKER_PUBLIC_URL=$NEXT_PUBLIC_WORKER_PUBLIC_URL
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@justdownload/web..."
COPY packages/core packages/core
COPY apps/web apps/web
RUN pnpm --filter @justdownload/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=root:root /repo/apps/web/.next/standalone ./
COPY --from=build --chown=root:root /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
