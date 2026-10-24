import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { assertTransition, type JobState } from "@justdownload/core";
import type { InspectionRecord, JobRecord, PendingUpload } from "./types";

/**
 * Durable job/inspection metadata. Redis (with AOF persistence in docker-compose) in deployments;
 * an in-memory implementation for tests and single-process development. See docs/ARCHITECTURE.md
 * for why Redis instead of Postgres for this milestone.
 */
export interface Store {
  saveInspection(rec: InspectionRecord, ttlMs: number): Promise<void>;
  getInspection(id: string): Promise<InspectionRecord | null>;
  savePendingUpload(rec: PendingUpload, ttlMs: number): Promise<void>;
  takePendingUpload(id: string): Promise<PendingUpload | null>;
  createJob(rec: JobRecord): Promise<void>;
  getJob(id: string): Promise<JobRecord | null>;
  /** Apply a mutation; if it changes `state` the transition is validated against the stored state. */
  updateJob(id: string, mutate: (j: JobRecord) => Partial<JobRecord> | null): Promise<JobRecord | null>;
  deleteJob(id: string): Promise<void>;
  claimIdempotency(sessionHash: string, key: string, jobId: string, ttlMs: number): Promise<string | null>;
  requestCancel(id: string): Promise<void>;
  isCancelRequested(id: string): Promise<boolean>;
  dueForExpiry(nowMs: number, limit: number): Promise<string[]>;
  activeJobIds(): Promise<string[]>;
  subscribe(id: string, fn: (j: JobRecord) => void): Promise<() => Promise<void>>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

function applyUpdate(cur: JobRecord, patch: Partial<JobRecord>): JobRecord {
  if (patch.state && patch.state !== cur.state) assertTransition(cur.state, patch.state as JobState);
  else if (patch.state === cur.state && cur.state === "queued" && patch.attempts !== undefined) assertTransition("queued", "queued");
  return { ...cur, ...patch, updatedAt: new Date().toISOString() };
}

export class MemoryStore implements Store {
  private insp = new Map<string, { rec: InspectionRecord; exp: number }>();
  private uploads = new Map<string, { rec: PendingUpload; exp: number }>();
  private jobs = new Map<string, JobRecord>();
  private idem = new Map<string, string>();
  private cancels = new Set<string>();
  private bus = new EventEmitter();
  constructor() { this.bus.setMaxListeners(1000); }
  async saveInspection(rec: InspectionRecord, ttlMs: number) { this.insp.set(rec.id, { rec, exp: Date.now() + ttlMs }); }
  async getInspection(id: string) {
    const e = this.insp.get(id);
    if (!e || e.exp < Date.now()) return null;
    return structuredClone(e.rec);
  }
  async savePendingUpload(rec: PendingUpload, ttlMs: number) { this.uploads.set(rec.id, { rec, exp: Date.now() + ttlMs }); }
  async takePendingUpload(id: string) {
    const e = this.uploads.get(id);
    this.uploads.delete(id);
    return e && e.exp >= Date.now() ? e.rec : null;
  }
  async createJob(rec: JobRecord) { this.jobs.set(rec.id, structuredClone(rec)); this.bus.emit(rec.id, structuredClone(rec)); }
  async getJob(id: string) { const j = this.jobs.get(id); return j ? structuredClone(j) : null; }
  async updateJob(id: string, mutate: (j: JobRecord) => Partial<JobRecord> | null) {
    const cur = this.jobs.get(id);
    if (!cur) return null;
    const patch = mutate(structuredClone(cur));
    if (!patch) return structuredClone(cur);
    const next = applyUpdate(cur, patch);
    this.jobs.set(id, next);
    this.bus.emit(id, structuredClone(next));
    return structuredClone(next);
  }
  async deleteJob(id: string) { this.jobs.delete(id); this.cancels.delete(id); }
  async claimIdempotency(sessionHash: string, key: string, jobId: string, _ttlMs?: number) {
    const k = `${sessionHash}:${key}`;
    const existing = this.idem.get(k);
    if (existing) return existing;
    this.idem.set(k, jobId);
    return null;
  }
  async requestCancel(id: string) { this.cancels.add(id); }
  async isCancelRequested(id: string) { return this.cancels.has(id); }
  async dueForExpiry(nowMs: number, limit: number) {
    return [...this.jobs.values()].filter((j) => Date.parse(j.expiresAt) <= nowMs && j.state !== "expired").slice(0, limit).map((j) => j.id);
  }
  async activeJobIds() { return [...this.jobs.values()].filter((j) => !["ready", "failed", "cancelled", "rejected_by_policy", "expired"].includes(j.state)).map((j) => j.id); }
  async subscribe(id: string, fn: (j: JobRecord) => void) {
    this.bus.on(id, fn);
    return async () => { this.bus.off(id, fn); };
  }
  async ping() { return true; }
  async close() { this.bus.removeAllListeners(); }
}

const K = {
  insp: (id: string) => `jd:insp:${id}`,
  upload: (id: string) => `jd:upload:${id}`,
  job: (id: string) => `jd:job:${id}`,
  idem: (s: string, k: string) => `jd:idem:${s}:${k}`,
  cancel: (id: string) => `jd:cancel:${id}`,
  expiry: "jd:jobs:expiry",
  active: "jd:jobs:active",
  events: (id: string) => `jd:events:${id}`,
};

const TERMINAL = new Set(["ready", "failed", "cancelled", "rejected_by_policy", "expired"]);

export class RedisStore implements Store {
  private readonly r: Redis;
  private sub: Redis | null = null;
  private listeners = new Map<string, Set<(j: JobRecord) => void>>();
  constructor(url: string) {
    this.r = new Redis(url, { maxRetriesPerRequest: 3, enableReadyCheck: true, lazyConnect: false });
  }
  get client(): Redis { return this.r; }
  async saveInspection(rec: InspectionRecord, ttlMs: number) { await this.r.set(K.insp(rec.id), JSON.stringify(rec), "PX", ttlMs); }
  async getInspection(id: string) { const v = await this.r.get(K.insp(id)); return v ? (JSON.parse(v) as InspectionRecord) : null; }
  async savePendingUpload(rec: PendingUpload, ttlMs: number) { await this.r.set(K.upload(rec.id), JSON.stringify(rec), "PX", ttlMs); }
  async takePendingUpload(id: string) { const v = await this.r.getdel(K.upload(id)); return v ? (JSON.parse(v) as PendingUpload) : null; }
  async createJob(rec: JobRecord) {
    await this.r.multi().set(K.job(rec.id), JSON.stringify(rec)).zadd(K.expiry, Date.parse(rec.expiresAt), rec.id).sadd(K.active, rec.id).exec();
    await this.r.publish(K.events(rec.id), JSON.stringify(rec));
  }
  async getJob(id: string) { const v = await this.r.get(K.job(id)); return v ? (JSON.parse(v) as JobRecord) : null; }
  async updateJob(id: string, mutate: (j: JobRecord) => Partial<JobRecord> | null) {
    // Optimistic concurrency: WATCH the key and retry if another process changed it.
    for (let attempt = 0; attempt < 8; attempt++) {
      await this.r.watch(K.job(id));
      const raw = await this.r.get(K.job(id));
      if (!raw) { await this.r.unwatch(); return null; }
      const cur = JSON.parse(raw) as JobRecord;
      const patch = mutate(structuredClone(cur));
      if (!patch) { await this.r.unwatch(); return cur; }
      const next = applyUpdate(cur, patch);
      const m = this.r.multi().set(K.job(id), JSON.stringify(next));
      if (TERMINAL.has(next.state)) m.srem(K.active, id);
      if (patch.expiresAt) m.zadd(K.expiry, Date.parse(next.expiresAt), id);
      const res = await m.exec();
      if (res) {
        await this.r.publish(K.events(id), JSON.stringify(next));
        return next;
      }
    }
    throw new Error("job update contention");
  }
  async deleteJob(id: string) { await this.r.multi().del(K.job(id), K.cancel(id)).zrem(K.expiry, id).srem(K.active, id).exec(); }
  async claimIdempotency(sessionHash: string, key: string, jobId: string, ttlMs: number) {
    const ok = await this.r.set(K.idem(sessionHash, key), jobId, "PX", ttlMs, "NX");
    if (ok) return null;
    return await this.r.get(K.idem(sessionHash, key));
  }
  async requestCancel(id: string) { await this.r.set(K.cancel(id), "1", "EX", 86_400); }
  async isCancelRequested(id: string) { return (await this.r.exists(K.cancel(id))) === 1; }
  async dueForExpiry(nowMs: number, limit: number) { return await this.r.zrangebyscore(K.expiry, 0, nowMs, "LIMIT", 0, limit); }
  async activeJobIds() { return await this.r.smembers(K.active); }
  async subscribe(id: string, fn: (j: JobRecord) => void) {
    if (!this.sub) {
      this.sub = this.r.duplicate();
      this.sub.on("message", (channel: string, msg: string) => {
        const jid = channel.slice("jd:events:".length);
        const set = this.listeners.get(jid);
        if (!set) return;
        const rec = JSON.parse(msg) as JobRecord;
        for (const f of set) f(rec);
      });
    }
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
      await this.sub.subscribe(K.events(id));
    }
    set.add(fn);
    return async () => {
      set!.delete(fn);
      if (set!.size === 0) {
        this.listeners.delete(id);
        await this.sub?.unsubscribe(K.events(id));
      }
    };
  }
  async ping() { try { return (await this.r.ping()) === "PONG"; } catch { return false; } }
  async close() { await this.sub?.quit().catch(() => undefined); await this.r.quit().catch(() => undefined); }
}
