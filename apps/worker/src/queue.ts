import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import type { QueueName } from "./types";

/** What a processor reports back so the queue can decide about retries. */
export class RetryableJobError extends Error {
  constructor(message: string) { super(message); this.name = "RetryableJobError"; }
}
export class PermanentJobError extends Error {
  constructor(message: string) { super(message); this.name = "PermanentJobError"; }
}

export interface ProcessContext {
  attempt: number;
  isLastAttempt: boolean;
}

export type Processor = (jobId: string, ctx: ProcessContext) => Promise<void>;

export interface JobQueue {
  enqueue(queue: QueueName, jobId: string): Promise<void>;
  /** Remove a job that hasn't started yet. Returns true if it was removed. */
  removeWaiting(queue: QueueName, jobId: string): Promise<boolean>;
  counts(): Promise<{ waiting: number; active: number; failed: number }>;
  startWorkers(processor: Processor, concurrency: { video: number; audio: number }): void;
  close(): Promise<void>;
}

const QUEUES: QueueName[] = ["video_download", "audio_conversion"];

/** Redis-backed queue (BullMQ): durable, lock-renewing workers, stalled-job recovery, backoff with jitter. */
export class BullQueue implements JobQueue {
  private queues: Map<QueueName, Queue>;
  private workers: Worker[] = [];
  constructor(private readonly redisUrl: string, private readonly attempts: number, private readonly jobTimeoutMs: number) {
    this.queues = new Map(QUEUES.map((q) => [q, new Queue(q, { connection: { url: redisUrl, maxRetriesPerRequest: null } })]));
  }
  async enqueue(queue: QueueName, jobId: string) {
    await this.queues.get(queue)!.add("process", { jobId }, {
      jobId, // idempotent: BullMQ ignores a second add with the same id
      attempts: this.attempts,
      backoff: { type: "exponential", delay: 4000, jitter: 0.5 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 86400, count: 5000 }, // failed-job visibility for operators
    });
  }
  async removeWaiting(queue: QueueName, jobId: string) {
    const job = await this.queues.get(queue)!.getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    if (state === "waiting" || state === "delayed" || state === "prioritized") {
      try { await job.remove(); return true; } catch { return false; }
    }
    return false;
  }
  async counts() {
    let waiting = 0, active = 0, failed = 0;
    for (const q of this.queues.values()) {
      const c = await q.getJobCounts("waiting", "active", "failed", "delayed", "prioritized");
      waiting += (c.waiting ?? 0) + (c.delayed ?? 0) + (c.prioritized ?? 0);
      active += c.active ?? 0;
      failed += c.failed ?? 0;
    }
    return { waiting, active, failed };
  }
  startWorkers(processor: Processor, concurrency: { video: number; audio: number }) {
    for (const q of QUEUES) {
      const w = new Worker(q, async (job: Job<{ jobId: string }>) => {
        const attempt = job.attemptsMade + 1;
        const isLastAttempt = attempt >= (job.opts.attempts ?? 1);
        try {
          await processor(job.data.jobId, { attempt, isLastAttempt });
        } catch (e) {
          if (e instanceof PermanentJobError) throw new UnrecoverableError(e.message);
          throw e;
        }
      }, {
        connection: { url: this.redisUrl, maxRetriesPerRequest: null },
        concurrency: q === "video_download" ? concurrency.video : concurrency.audio,
        lockDuration: 60_000,
        stalledInterval: 30_000,
        maxStalledCount: 1,
      });
      w.on("error", () => undefined);
      this.workers.push(w);
    }
    void this.jobTimeoutMs;
  }
  async close() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

/** In-process queue for tests and single-process dev without Redis. Not durable. */
export class LocalQueue implements JobQueue {
  private pending: Record<QueueName, string[]> = { video_download: [], audio_conversion: [] };
  private running: Record<QueueName, number> = { video_download: 0, audio_conversion: 0 };
  private processor: Processor | null = null;
  private concurrency = { video: 1, audio: 1 };
  private failed = 0;
  private seen = new Set<string>();
  private idle: Array<() => void> = [];
  constructor(private readonly attempts = 3, private readonly backoffMs = 50) {}
  async enqueue(queue: QueueName, jobId: string) {
    if (this.seen.has(jobId)) return;
    this.seen.add(jobId);
    this.pending[queue].push(jobId);
    this.pump(queue);
  }
  async removeWaiting(queue: QueueName, jobId: string) {
    const i = this.pending[queue].indexOf(jobId);
    if (i < 0) return false;
    this.pending[queue].splice(i, 1);
    return true;
  }
  async counts() {
    return { waiting: this.pending.video_download.length + this.pending.audio_conversion.length, active: this.running.video_download + this.running.audio_conversion, failed: this.failed };
  }
  startWorkers(processor: Processor, concurrency: { video: number; audio: number }) {
    this.processor = processor;
    this.concurrency = concurrency;
    for (const q of QUEUES) this.pump(q);
  }
  /** Resolves when nothing is queued or running (tests). */
  drained(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }
  private isIdle() {
    return QUEUES.every((q) => this.pending[q].length === 0 && this.running[q] === 0);
  }
  private pump(queue: QueueName) {
    if (!this.processor) return;
    const limit = queue === "video_download" ? this.concurrency.video : this.concurrency.audio;
    while (this.running[queue] < limit && this.pending[queue].length) {
      const id = this.pending[queue].shift()!;
      this.running[queue]++;
      void this.run(queue, id, 1).finally(() => {
        this.running[queue]--;
        this.pump(queue);
        if (this.isIdle()) this.idle.splice(0).forEach((r) => r());
      });
    }
  }
  private async run(queue: QueueName, id: string, attempt: number): Promise<void> {
    try {
      await this.processor!(id, { attempt, isLastAttempt: attempt >= this.attempts });
    } catch (e) {
      if (e instanceof PermanentJobError || attempt >= this.attempts) { this.failed++; return; }
      await new Promise((r) => setTimeout(r, this.backoffMs * 2 ** (attempt - 1)));
      return this.run(queue, id, attempt + 1);
    }
  }
  async close() { this.processor = null; }
}
