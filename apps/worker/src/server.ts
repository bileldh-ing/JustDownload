import { constants, createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  CreateJobRequestSchema, ID_RE, InspectRequestSchema, JdError, TERMINAL_STATES, contentDisposition, errorBody,
  type UploadTicket, type WorkerHealth,
} from "@justdownload/core";
import { newId, sha256Hex, signCapability, verifyCapability } from "@justdownload/core/node";
import type { WorkerConfig } from "./config";
import { inspectUpload, inspectUrl, toView } from "./inspect";
import type { Logger } from "./log";
import { WORKER_VERSION } from "./pipeline";
import type { JobQueue } from "./queue";
import { RateLimiter } from "./ratelimit";
import { cancelJob, createJob, deleteJob, getOwnedJob, toJobView } from "./service";
import type { ArtifactStorage } from "./storage";
import type { Store } from "./store";
import type { ToolInfo } from "./tools";

export interface ServerDeps {
  config: WorkerConfig;
  store: Store;
  storage: ArtifactStorage;
  queue: JobQueue;
  tools: ToolInfo;
  log: Logger;
  resolver?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Worker HTTP API.
 *  - /v1/* (except signed routes) requires `Authorization: Bearer <WORKER_API_TOKEN>`; only the
 *    JustDownload web backend holds it. It forwards an opaque guest session id (x-jd-session) that
 *    is hashed and used for ownership checks.
 *  - Downloads, uploads and SSE use short-lived HMAC-signed URLs so browsers can talk to the worker
 *    directly without the shared token.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config: cfg, store, log } = deps;
  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024,
    trustProxy: false,
    genReqId: () => newId(9),
  });
  const limiter = new RateLimiter(cfg.rateLimitPerMin, 60_000);

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin ? false : cfg.corsOrigins.includes(origin)),
    methods: ["GET", "PUT"],
    allowedHeaders: ["content-type", "x-filename"],
    maxAge: 600,
  });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cache-control", reply.getHeader("cache-control") ?? "no-store");
  });

  app.addHook("onResponse", async (req, reply) => {
    // Path only: never log query strings (signatures) or bodies (URLs).
    log.info({ request_id: req.id, method: req.method, route: req.routeOptions.url ?? "unknown", status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, "request");
  });

  app.setErrorHandler((err, req, reply) => {
    let e: JdError;
    if (err instanceof JdError) e = err;
    else if ((err as { validation?: unknown }).validation || (err as { statusCode?: number }).statusCode === 400 || (err as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE") e = new JdError("BAD_REQUEST");
    else e = new JdError("INTERNAL", { internal: (err as Error).message });
    if (e.code === "INTERNAL") log.error({ request_id: req.id, error_code: e.code, detail: e.internal }, "unhandled error");
    else log.warn({ request_id: req.id, error_code: e.code, detail: e.internal }, "request error");
    const { status, body } = errorBody(e, String(req.id));
    void reply.status(status).send(body);
  });

  const requireApi = (req: FastifyRequest): string => {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !safeEqual(token, cfg.apiToken)) throw new JdError("UNAUTHORIZED");
    const sid = String(req.headers["x-jd-session"] ?? "");
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(sid)) throw new JdError("UNAUTHORIZED");
    const client = String(req.headers["x-jd-client"] ?? sid);
    if (!limiter.take(client)) throw new JdError("RATE_LIMITED");
    return sha256Hex(`session:${sid}`);
  };

  // ------------------------------------------------------------------ health
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_req, reply) => {
    const ok = (await store.ping()) && !!deps.tools.ffmpeg && !!deps.tools.ffprobe;
    return reply.status(ok ? 200 : 503).send({ ready: ok });
  });
  app.get("/v1/health", async (req): Promise<WorkerHealth> => {
    const auth = req.headers.authorization ?? "";
    if (!safeEqual(auth.startsWith("Bearer ") ? auth.slice(7) : "", cfg.apiToken)) throw new JdError("UNAUTHORIZED");
    let queue: WorkerHealth["queue"];
    try { queue = await Promise.race([deps.queue.counts(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000))]); } catch { queue = null; }
    const storeOk = await store.ping();
    const accepting = storeOk && !!deps.tools.ffmpeg && !!deps.tools.ffprobe && (queue == null || (queue.waiting ?? 0) < cfg.maxQueueDepth);
    return {
      status: accepting ? "ok" : "degraded", version: WORKER_VERSION,
      tools: { ffmpeg: deps.tools.ffmpeg, ffprobe: deps.tools.ffprobe, ytdlp: deps.tools.ytdlp },
      queue, accepting_jobs: accepting,
      limits: { max_source_bytes: cfg.maxSourceBytes, max_duration_sec: cfg.maxDurationSec, retention_minutes: Math.round(cfg.retentionMs / 60_000), max_upload_bytes: cfg.maxUploadBytes },
      public_url: cfg.publicUrl,
    };
  });

  // ------------------------------------------------------------- inspections
  app.post("/v1/inspections", async (req) => {
    const session = requireApi(req);
    const body = InspectRequestSchema.safeParse(req.body);
    if (!body.success) throw new JdError("BAD_REQUEST");
    return inspectUrl(body.data.url, session, deps);
  });
  app.get<{ Params: { id: string } }>("/v1/inspections/:id", async (req) => {
    const session = requireApi(req);
    if (!ID_RE.test(req.params.id)) throw new JdError("INSPECTION_NOT_FOUND");
    const rec = await store.getInspection(req.params.id);
    if (!rec || rec.sessionHash !== session) throw new JdError("INSPECTION_NOT_FOUND");
    return toView(rec, deps);
  });

  // ------------------------------------------------------------------- jobs
  app.post("/v1/jobs", async (req, reply) => {
    const session = requireApi(req);
    const body = CreateJobRequestSchema.safeParse(req.body);
    if (!body.success) throw new JdError("BAD_REQUEST");
    const job = await createJob(body.data, session, deps);
    return reply.status(202).send(toJobView(job, cfg));
  });
  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (req) => {
    const session = requireApi(req);
    return toJobView(await getOwnedJob(req.params.id, session, store), cfg);
  });
  app.post<{ Params: { id: string } }>("/v1/jobs/:id/cancel", async (req) => {
    const session = requireApi(req);
    const job = await getOwnedJob(req.params.id, session, store);
    const after = await cancelJob(job, deps);
    return toJobView((await store.getJob(job.id)) ?? after, cfg);
  });
  app.delete<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    const session = requireApi(req);
    const job = await getOwnedJob(req.params.id, session, store);
    await deleteJob(job, deps);
    return reply.status(204).send();
  });

  // ---------------------------------------------------- signed: artifact download
  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>("/v1/jobs/:id/download", async (req, reply: FastifyReply) => {
    const v = verifyCapability(cfg.signingSecret, "download", req.params.id, req.query.exp, req.query.sig);
    if (v === "expired") throw new JdError("LINK_EXPIRED");
    if (v !== "ok") throw new JdError("UNAUTHORIZED");
    const job = await store.getJob(req.params.id);
    if (!job) throw new JdError("JOB_NOT_FOUND");
    if (job.state === "expired") throw new JdError("ARTIFACT_EXPIRED");
    if (job.state !== "ready" || !job.artifact) throw new JdError("JOB_NOT_READY");
    const st = await deps.storage.stat(job.artifact.storageKey);
    if (!st) throw new JdError("ARTIFACT_EXPIRED");
    reply.header("content-type", job.artifact.mime_type);
    reply.header("content-length", String(st.size));
    reply.header("content-disposition", contentDisposition(job.artifact.filename));
    reply.header("cache-control", "private, no-store");
    const stream = deps.storage.read(job.artifact.storageKey);
    req.raw.on("close", () => stream.destroy()); // client aborted: stop reading; the artifact stays intact
    return reply.send(stream);
  });

  // ---------------------------------------------------------- signed: SSE events
  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>("/v1/jobs/:id/events", async (req, reply) => {
    const v = verifyCapability(cfg.signingSecret, "events", req.params.id, req.query.exp, req.query.sig);
    if (v !== "ok") throw new JdError(v === "expired" ? "LINK_EXPIRED" : "UNAUTHORIZED");
    const job = await store.getJob(req.params.id);
    if (!job) throw new JdError("JOB_NOT_FOUND");
    const origin = req.headers.origin;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no",
      ...(origin && cfg.corsOrigins.includes(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    });
    let closed = false;
    const send = (j: typeof job) => {
      if (closed) return;
      res.write(`event: progress\ndata: ${JSON.stringify(toJobView(j, cfg))}\n\n`);
      if (TERMINAL_STATES.has(j.state)) finish();
    };
    const ping = setInterval(() => { if (!closed) res.write(": keep-alive\n\n"); }, 15_000);
    const unsub = await store.subscribe(job.id, send);
    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      void unsub();
      res.end();
    };
    req.raw.on("close", finish);
    res.write("retry: 3000\n\n");
    send((await store.getJob(job.id)) ?? job);
  });

  // ---------------------------------------------------------------- uploads
  app.post("/v1/uploads/ticket", async (req): Promise<UploadTicket> => {
    const session = requireApi(req);
    if (!cfg.publicUrl) throw new JdError("WORKER_UNAVAILABLE", { internal: "PUBLIC_URL not set; browser uploads need a public worker URL" });
    const id = newId();
    const ttl = 900;
    await store.savePendingUpload({ id, sessionHash: session, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() }, ttl * 1000);
    const { exp, sig } = signCapability(cfg.signingSecret, "upload", id, ttl);
    return { upload_url: `${cfg.publicUrl}/v1/uploads/${id}?exp=${exp}&sig=${sig}`, max_bytes: cfg.maxUploadBytes, expires_at: new Date(exp * 1000).toISOString() };
  });

  await app.register(async (scope) => {
    // Raw streaming body for uploads only; everything else keeps the 16 KB JSON limit.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_req, _payload, done) => done(null));
    scope.put<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>("/v1/uploads/:id", { bodyLimit: cfg.maxUploadBytes }, async (req) => {
      const v = verifyCapability(cfg.signingSecret, "upload", req.params.id, req.query.exp, req.query.sig);
      if (v !== "ok") throw new JdError(v === "expired" ? "LINK_EXPIRED" : "UNAUTHORIZED");
      const pending = await store.takePendingUpload(req.params.id); // single use
      if (!pending) throw new JdError("UNAUTHORIZED");
      const declared = Number(req.headers["content-length"] ?? NaN);
      if (!Number.isFinite(declared) || declared <= 0) throw new JdError("UPLOAD_INVALID");
      if (declared > cfg.maxUploadBytes) throw new JdError("SOURCE_TOO_LARGE");
      const dir = path.join(cfg.dataDir, "uploads", req.params.id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, "source");
      const fh = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      let n = 0;
      const cap = new Transform({ transform(chunk: Buffer, _e, cb) { n += chunk.length; if (n > cfg.maxUploadBytes) return cb(new JdError("SOURCE_TOO_LARGE")); cb(null, chunk); } });
      try {
        await pipeline(req.raw, cap, createWriteStream("", { fd: fh.fd, autoClose: false }));
      } catch (e) {
        await rm(dir, { recursive: true, force: true });
        throw e instanceof JdError ? e : new JdError("UPLOAD_INVALID");
      } finally {
        await fh.close().catch(() => undefined);
      }
      if (n !== declared) { await rm(dir, { recursive: true, force: true }); throw new JdError("UPLOAD_INVALID", { internal: "short upload" }); }
      let name: string | null;
      try { name = req.headers["x-filename"] ? decodeURIComponent(String(req.headers["x-filename"])) : null; } catch { name = null; }
      try {
        return await inspectUpload(file, req.params.id, name, pending.sessionHash, deps);
      } catch (e) {
        await rm(dir, { recursive: true, force: true });
        throw e;
      }
    });
  });

  return app;
}
