import path from "node:path";
import { z } from "zod";
import { buildRegistry, parsePolicyOverrides, type ProviderPolicy } from "@justdownload/core";

const MB = 1024 * 1024;

const Env = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default("0.0.0.0"),
  REDIS_URL: z.string().optional(),
  WORKER_API_TOKEN: z.string().optional(),
  SIGNING_SECRET: z.string().optional(),
  PUBLIC_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default(""),
  DATA_DIR: z.string().default("./data"),
  MAX_SOURCE_MB: z.coerce.number().positive().default(1024),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(512),
  MAX_DURATION_MIN: z.coerce.number().positive().default(180),
  RETENTION_MINUTES: z.coerce.number().positive().default(60),
  INSPECTION_TTL_MIN: z.coerce.number().positive().default(30),
  CONCURRENCY_VIDEO: z.coerce.number().int().positive().default(1),
  CONCURRENCY_AUDIO: z.coerce.number().int().positive().default(2),
  JOB_TIMEOUT_MIN: z.coerce.number().positive().default(30),
  MAX_QUEUE_DEPTH: z.coerce.number().int().positive().default(100),
  MAX_DISK_GB: z.coerce.number().positive().default(10),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
  JOB_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  JD_PROVIDER_POLICY_OVERRIDES: z.string().optional(),
  JD_ALLOW_PRIVATE_NETWORK: z.string().optional(),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  YTDLP_PATH: z.string().default("yt-dlp"),
  LOG_LEVEL: z.string().default("info"),
});

export interface WorkerConfig {
  env: string;
  port: number;
  host: string;
  redisUrl: string | null;
  apiToken: string;
  signingSecret: string;
  publicUrl: string | null;
  corsOrigins: string[];
  dataDir: string;
  maxSourceBytes: number;
  maxUploadBytes: number;
  maxDurationSec: number;
  retentionMs: number;
  inspectionTtlMs: number;
  concurrency: { video: number; audio: number };
  jobTimeoutMs: number;
  maxQueueDepth: number;
  maxDiskBytes: number;
  rateLimitPerMin: number;
  jobAttempts: number;
  registry: ProviderPolicy[];
  allowPrivateNetwork: boolean;
  tools: { ffmpeg: string; ffprobe: string; ytdlp: string };
  logLevel: string;
  /** Bytes fetched for the first inspection pass. */
  headBytes: number;
  /** If the head isn't enough for FFprobe, the whole file is fetched when it's at most this big. */
  fullProbeMaxBytes: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const e = Env.parse(source);
  const production = e.NODE_ENV === "production";
  if (production && (!e.WORKER_API_TOKEN || e.WORKER_API_TOKEN.length < 24)) throw new Error("WORKER_API_TOKEN (>= 24 chars) is required in production");
  if (production && (!e.SIGNING_SECRET || e.SIGNING_SECRET.length < 32)) throw new Error("SIGNING_SECRET (>= 32 chars) is required in production");
  const allowPrivate = e.JD_ALLOW_PRIVATE_NETWORK === "1";
  if (allowPrivate && production) throw new Error("JD_ALLOW_PRIVATE_NETWORK must never be enabled in production");
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    redisUrl: e.REDIS_URL ?? null,
    apiToken: e.WORKER_API_TOKEN ?? "dev-worker-token-change-me",
    signingSecret: e.SIGNING_SECRET ?? "dev-signing-secret-change-me-dev-signing-secret",
    publicUrl: e.PUBLIC_URL ? e.PUBLIC_URL.replace(/\/$/, "") : null,
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    dataDir: path.resolve(e.DATA_DIR),
    maxSourceBytes: Math.round(e.MAX_SOURCE_MB * MB),
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * MB),
    maxDurationSec: Math.round(e.MAX_DURATION_MIN * 60),
    retentionMs: Math.round(e.RETENTION_MINUTES * 60_000),
    inspectionTtlMs: Math.round(e.INSPECTION_TTL_MIN * 60_000),
    concurrency: { video: e.CONCURRENCY_VIDEO, audio: e.CONCURRENCY_AUDIO },
    jobTimeoutMs: Math.round(e.JOB_TIMEOUT_MIN * 60_000),
    maxQueueDepth: e.MAX_QUEUE_DEPTH,
    maxDiskBytes: Math.round(e.MAX_DISK_GB * 1024 * MB),
    rateLimitPerMin: e.RATE_LIMIT_PER_MIN,
    jobAttempts: e.JOB_ATTEMPTS,
    registry: buildRegistry(parsePolicyOverrides(e.JD_PROVIDER_POLICY_OVERRIDES)),
    allowPrivateNetwork: allowPrivate,
    tools: { ffmpeg: e.FFMPEG_PATH, ffprobe: e.FFPROBE_PATH, ytdlp: e.YTDLP_PATH },
    logLevel: e.LOG_LEVEL,
    headBytes: 8 * MB,
    fullProbeMaxBytes: 64 * MB,
  };
}
