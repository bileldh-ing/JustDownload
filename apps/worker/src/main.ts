import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { sweep } from "./cleanup";
import { createLogger } from "./log";
import { processJob } from "./pipeline";
import { BullQueue, LocalQueue, type JobQueue } from "./queue";
import { buildServer } from "./server";
import { LocalStorage } from "./storage";
import { MemoryStore, RedisStore, type Store } from "./store";
import { detectTools } from "./tools";

/**
 * Entry point. Modes:
 *   api     HTTP API only (inspections, job creation, signed downloads/uploads, SSE)
 *   worker  queue consumers + retention sweeper only
 *   all     both in one process (default; fine for small self-hosted deployments)
 * Without REDIS_URL the worker runs with an in-memory store and in-process queue (development only).
 */
async function main() {
  const mode = (process.argv[2] ?? process.env.WORKER_MODE ?? "all") as "api" | "worker" | "all";
  const cfg = loadConfig();
  const log = createLogger(cfg.logLevel);
  for (const d of ["inspections", "uploads", "work", "job-sources", "artifacts"]) await mkdir(path.join(cfg.dataDir, d), { recursive: true, mode: 0o700 });
  const tools = await detectTools(cfg.tools);
  log.info({ stage: "startup", mode, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe, ytdlp: tools.ytdlp, encoders: tools.encoders, redis: !!cfg.redisUrl }, "worker starting");
  if (!tools.ffmpeg || !tools.ffprobe) log.error({ stage: "startup" }, "ffmpeg/ffprobe not found: processing is unavailable");
  if (!cfg.redisUrl && mode !== "all") throw new Error("REDIS_URL is required when api and worker run as separate processes");
  if (!cfg.redisUrl) log.warn({ stage: "startup" }, "REDIS_URL not set: using in-memory store and queue (development only, not durable)");

  const store: Store = cfg.redisUrl ? new RedisStore(cfg.redisUrl) : new MemoryStore();
  const queue: JobQueue = cfg.redisUrl ? new BullQueue(cfg.redisUrl, cfg.jobAttempts, cfg.jobTimeoutMs) : new LocalQueue(cfg.jobAttempts, 2000);
  const storage = new LocalStorage(path.join(cfg.dataDir, "artifacts"));
  const deps = { config: cfg, store, storage, queue, tools, log };

  let server: Awaited<ReturnType<typeof buildServer>> | null = null;
  let sweeper: NodeJS.Timeout | null = null;
  if (mode === "api" || mode === "all") {
    server = await buildServer(deps);
    await server.listen({ port: cfg.port, host: cfg.host });
    log.info({ stage: "startup", port: cfg.port }, "api listening");
  }
  if (mode === "worker" || mode === "all") {
    queue.startWorkers((jobId, ctx) => processJob(jobId, ctx, deps), cfg.concurrency);
    sweeper = setInterval(() => { void sweep(deps).catch((e) => log.error({ stage: "cleanup", detail: String(e) }, "sweep failed")); }, 60_000);
    log.info({ stage: "startup", concurrency: cfg.concurrency }, "queue workers started");
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ stage: "shutdown", signal }, "draining");
    if (sweeper) clearInterval(sweeper);
    await server?.close().catch(() => undefined);
    await queue.close().catch(() => undefined); // waits for active jobs to finish their current attempt
    await store.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error(JSON.stringify({ level: "fatal", msg: "worker failed to start", detail: String(e?.message ?? e) }));
  process.exit(1);
});
