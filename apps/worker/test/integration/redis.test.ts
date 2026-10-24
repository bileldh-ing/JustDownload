import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InspectionView } from "@justdownload/core";
import { BullQueue } from "../../src/queue";
import { RedisStore } from "../../src/store";
import { ensureFixtures, startFixtureServer, type FixtureServer } from "../fixtures";
import { api, makeHarness, waitForJob, type Harness } from "../harness";

/**
 * Durable path: RedisStore + BullMQ queues. Requires REDIS_URL (CI provides a Redis service).
 * Without it the suite is reported as SKIPPED, not passed.
 */
const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("Redis + BullMQ durable pipeline", () => {
  let fx: FixtureServer;
  let h: Harness;
  beforeAll(async () => {
    await ensureFixtures();
    fx = await startFixtureServer();
    const store = new RedisStore(REDIS_URL!);
    await store.client.flushdb();
    h = await makeHarness({ headBytes: 32 * 1024, fullProbeMaxBytes: 1024, redisUrl: REDIS_URL! }, { store, queue: new BullQueue(REDIS_URL!, 3, 60_000) });
  });
  afterAll(async () => {
    await h?.close();
    await fx?.close();
  });

  it("runs a job through Redis-backed queues and persists every state", async () => {
    const insp = (await h.app.inject({ method: "POST", url: "/v1/inspections", headers: api(), payload: { url: `${fx.base}/clip.mp4` } })).json() as InspectionView;
    const created = (await h.app.inject({ method: "POST", url: "/v1/jobs", headers: api(), payload: { inspection_id: insp.id, option_id: "audio:mp3-v2", idempotency_key: "redis-key-1" } })).json();
    const dup = (await h.app.inject({ method: "POST", url: "/v1/jobs", headers: api(), payload: { inspection_id: insp.id, option_id: "audio:mp3-v2", idempotency_key: "redis-key-1" } })).json();
    expect(dup.id).toBe(created.id);
    const seen = new Set<string>();
    const unsub = await h.store.subscribe(created.id, (j) => seen.add(j.state));
    const job = await waitForJob(h, created.id, (j) => ["ready", "failed"].includes(j.state), 60_000);
    await new Promise((r) => setTimeout(r, 300)); // let the last pub/sub message arrive
    await unsub();
    expect(job.state).toBe("ready");
    expect([...seen]).toEqual(expect.arrayContaining(["downloading", "converting", "validating_output", "ready"]));
    const counts = await h.queue.counts();
    expect(counts.active).toBe(0);
  });

  it("retries transient failures through BullMQ backoff", async () => {
    const insp = (await h.app.inject({ method: "POST", url: "/v1/inspections", headers: api(), payload: { url: `${fx.base}/flaky/clip.mkv` } })).json() as InspectionView;
    const created = (await h.app.inject({ method: "POST", url: "/v1/jobs", headers: api(), payload: { inspection_id: insp.id, option_id: "audio:wav" } })).json();
    const job = await waitForJob(h, created.id, (j) => ["ready", "failed"].includes(j.state), 60_000);
    expect(job.state).toBe("ready");
    expect(job.attempts).toBe(2);
  });
});
