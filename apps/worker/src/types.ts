import type { ArtifactView, ErrorCode, JobState, MediaProbe, OutputOption } from "@justdownload/core";

export type QueueName = "video_download" | "audio_conversion";

export interface SourceRef {
  kind: "url" | "upload";
  /** Full URL, kept only for the inspection/job lifetime (needed to fetch). Never logged. */
  href: string | null;
  redacted: string | null;
  host: string | null;
  filename: string | null;
}

export interface InspectionRecord {
  id: string;
  sessionHash: string;
  createdAt: string;
  expiresAt: string;
  source: SourceRef;
  providerId: string;
  probe: MediaProbe;
  sniffed: string | null;
  /** Absolute path of a complete copy of the source fetched during inspection (reused by jobs). */
  cachedSource: string | null;
  notices: string[];
}

export interface StoredArtifact extends ArtifactView {
  storageKey: string;
  versions: { worker: string; ffmpeg: string | null; ffprobe: string | null };
}

export interface JobRecord {
  id: string;
  sessionHash: string;
  idempotencyKey: string | null;
  state: JobState;
  percent: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  speed: number | null;
  eta: number | null;
  messageCode: string | null;
  error: { code: ErrorCode; message: string; action: string; retryable: boolean } | null;
  option: OutputOption;
  filename: string;
  inspectionId: string;
  providerId: string;
  source: SourceRef;
  probe: MediaProbe;
  sniffed: string | null;
  cachedSource: string | null;
  queue: QueueName;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  artifact: StoredArtifact | null;
}

export interface PendingUpload {
  id: string;
  sessionHash: string;
  expiresAt: string;
}
