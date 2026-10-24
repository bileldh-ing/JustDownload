import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { TERMINAL_STATES } from "@justdownload/core";
import type { WorkerConfig } from "./config";
import type { Logger } from "./log";
import type { ArtifactStorage } from "./storage";
import type { Store } from "./store";

export interface CleanupDeps {
  config: WorkerConfig;
  store: Store;
  storage: ArtifactStorage;
  log: Logger;
}

async function removeOldDirs(root: string, olderThanMs: number, keep: Set<string>, now: number): Promise<number> {
  let removed = 0;
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (!e.isDirectory() || keep.has(e.name)) continue;
    const p = path.join(root, e.name);
    const s = await stat(p).catch(() => null);
    if (s && now - s.mtimeMs > olderThanMs) {
      await rm(p, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

/**
 * Retention sweep: expire finished jobs past their expiry (deleting artifacts), and remove orphaned
 * temp directories. Active jobs are never touched.
 */
export async function sweep(deps: CleanupDeps, now = Date.now()): Promise<{ expired: number; orphans: number }> {
  const { store, storage, config: cfg } = deps;
  let expired = 0;
  for (const id of await store.dueForExpiry(now, 200)) {
    const job = await store.getJob(id);
    if (!job) continue;
    if (!TERMINAL_STATES.has(job.state)) continue;
    await storage.deleteJob(id);
    await rm(path.join(cfg.dataDir, "job-sources", id), { recursive: true, force: true });
    if (job.state !== "expired") {
      await store.updateJob(id, () => ({ state: "expired", artifact: null, percent: null, expiresAt: new Date(now + 24 * 3600_000).toISOString() }));
      expired++;
    } else {
      await store.deleteJob(id); // expired a day ago: drop the record entirely
    }
  }
  const active = new Set(await store.activeJobIds());
  let orphans = 0;
  orphans += await removeOldDirs(path.join(cfg.dataDir, "inspections"), cfg.inspectionTtlMs, new Set(), now);
  orphans += await removeOldDirs(path.join(cfg.dataDir, "uploads"), cfg.inspectionTtlMs, new Set(), now);
  orphans += await removeOldDirs(path.join(cfg.dataDir, "work"), cfg.jobTimeoutMs * 2, active, now);
  orphans += await removeOldDirs(path.join(cfg.dataDir, "job-sources"), cfg.retentionMs + cfg.jobTimeoutMs * 2, active, now);
  if (expired || orphans) deps.log.info({ stage: "cleanup", expired, orphans }, "retention sweep");
  return { expired, orphans };
}
