# JustDownload media worker: Node API + BullMQ consumers + FFmpeg/FFprobe.
# Build from the repository root:  docker build -f docker/worker.Dockerfile -t justdownload-worker .
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@justdownload/worker..."
COPY packages/core packages/core
COPY apps/worker apps/worker
RUN pnpm --filter @justdownload/worker build \
 && pnpm --filter @justdownload/worker deploy --prod --legacy /out \
 && rm -rf /out/src /out/test /out/build.mjs /out/vitest.config.ts /out/tsconfig.json

FROM node:22-bookworm-slim
# Debian's FFmpeg build (see docs/THIRD_PARTY_NOTICES.md for its licence). tini reaps child processes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=build --chown=root:root /out /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 HOST=0.0.0.0
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/main.js"]
# Modes: "all" (API + consumers), "api", or "worker".
CMD ["all"]
