import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JobView } from "@justdownload/core";
import { loadConfig, type WorkerConfig } from "../src/config";
import { silentLogger } from "../src/log";
import { processJob } from "../src/pipeline";
import { LocalQueue, type JobQueue } from "../src/queue";
import { buildServer } from "../src/server";
import { LocalStorage } from "../src/storage";
import { MemoryStore, type Store } from "../src/store";
import { detectTools, type ToolInfo } from "../src/tools";

export const TOKEN = "test-worker-token-0123456789abcdef";
export const SESSION = "session_AAAAAAAAAAAAAAAAAAAAAAAA";
export const OTHER_SESSION = "session_BBBBBBBBBBBBBBBBBBBBBBBB";

export interface Harness {
  app: Awaited<ReturnType<typeof buildServer>>;
  cfg: WorkerConfig;
  store: Store;
  queue: JobQueue & { drained?: () => Promise<void> };
  tools: ToolInfo;
  storage: LocalStorage;
  dataDir: string;
  close(): Promise<void>;
}

export async function makeHarness(over: Partial<WorkerConfig> = {}, opts: { store?: Store; queue?: JobQueue } = {}): Promise<Harness> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "jd-worker-"));
  const base = loadConfig({ NODE_ENV: "test", WORKER_API_TOKEN: TOKEN, SIGNING_SECRET: "test-signing-secret-0123456789abcdef0123", PUBLIC_URL: "http://worker.test", DATA_DIR: dataDir, JD_ALLOW_PRIVATE_NETWORK: "1", RATE_LIMIT_PER_MIN: "10000" });
  const cfg: WorkerConfig = { ...base, ...over };
  const tools = await detectTools(cfg.tools);
  const store = opts.store ?? new MemoryStore();
  const queue = opts.queue ?? new LocalQueue(cfg.jobAttempts, 20);
  const storage = new LocalStorage(path.join(dataDir, "artifacts"));
  const deps = { config: cfg, store, storage, queue, tools, log: silentLogger };
  const app = await buildServer(deps);
  queue.startWorkers((id, ctx) => processJob(id, ctx, deps), cfg.concurrency);
  return {
    app, cfg, store, queue: queue as Harness["queue"], tools, storage, dataDir,
    close: async () => { await queue.close(); await app.close(); await store.close(); await rm(dataDir, { recursive: true, force: true }); },
  };
}

export function api(session = SESSION) {
  return { authorization: `Bearer ${TOKEN}`, "x-jd-session": session };
}

export async function waitForJob(h: Harness, id: string, until: (j: JobView) => boolean, timeoutMs = 30_000, session = SESSION): Promise<JobView> {
  const start = Date.now();
  for (;;) {
    const res = await h.app.inject({ method: "GET", url: `/v1/jobs/${id}`, headers: api(session) });
    const j = res.json() as JobView;
    if (until(j)) return j;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for job; last state ${j.state}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function pathOf(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}
