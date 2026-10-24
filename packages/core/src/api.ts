import { z } from "zod";
import type { ErrorCode } from "./errors";
import type { JobState } from "./jobs";
import type { AudioStream, OutputOption, VideoStream } from "./media";
import type { PublicProvider } from "./providers";

/** API request schemas. Strict: unknown keys are rejected so a client can't smuggle policy fields. */
export const InspectRequestSchema = z.strictObject({ url: z.string().min(1).max(4096) });
export type InspectRequest = z.infer<typeof InspectRequestSchema>;

export const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const CreateJobRequestSchema = z.strictObject({
  inspection_id: z.string().regex(ID_RE),
  option_id: z.string().regex(/^[a-z0-9:-]{3,40}$/),
  filename: z.string().max(200).optional(),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export interface MediaSummary {
  title: string | null;
  artist: string | null;
  duration_sec: number | null;
  size_bytes: number | null;
  container: string;
  format_name: string;
  bit_rate: number | null;
  video: VideoStream[];
  audio: AudioStream[];
  partial: boolean;
}

export interface BasicProbe {
  content_type: string | null;
  content_length: number | null;
  accept_ranges: boolean;
  sniffed_label: string;
  sniffed_container: string | null;
  kind: "video" | "audio" | "audio_or_video" | "manifest" | "document" | "unknown";
  final_host: string;
  redirects: number;
}

export interface InspectionView {
  /** Null when no worker is configured (basic inspection cannot start jobs). */
  id: string | null;
  mode: "full" | "basic" | "policy";
  source: { kind: "url" | "upload"; host: string | null; redacted: string | null; filename: string | null };
  provider: PublicProvider;
  download_allowed: boolean;
  media: MediaSummary | null;
  basic: BasicProbe | null;
  options: OutputOption[];
  notices: string[];
  inspected_at: string;
  expires_at: string | null;
}

export interface ArtifactView {
  filename: string;
  size_bytes: number;
  sha256: string;
  mime_type: string;
  container: string;
  duration_sec: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
  expires_at: string;
}

export interface JobView {
  id: string;
  state: JobState;
  stage_label: string;
  percent: number | null;
  downloaded_bytes: number | null;
  total_bytes: number | null;
  speed_bytes_per_second: number | null;
  eta_seconds: number | null;
  message_code: string | null;
  error: { code: ErrorCode; message: string; action: string; retryable: boolean } | null;
  option: { id: string; label: string; extension: string; kind: "video" | "audio"; operation: string };
  filename: string;
  source: { kind: "url" | "upload"; host: string | null; provider_id: string };
  attempts: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  artifact: ArtifactView | null;
  /** Short-lived signed URL; present only when state is ready. */
  download_url: string | null;
  /** Signed SSE URL on the worker, when it is publicly reachable. */
  events_url: string | null;
}

export interface WorkerHealth {
  status: "ok" | "degraded";
  version: string;
  tools: { ffmpeg: string | null; ffprobe: string | null; ytdlp: string | null };
  queue: { waiting: number | null; active: number | null; failed: number | null } | null;
  accepting_jobs: boolean;
  limits: { max_source_bytes: number; max_duration_sec: number; retention_minutes: number; max_upload_bytes: number };
  public_url: string | null;
}

export interface UploadTicket {
  upload_url: string;
  max_bytes: number;
  expires_at: string;
}
