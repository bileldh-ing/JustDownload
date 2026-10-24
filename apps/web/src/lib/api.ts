import { z } from "zod";
import type { InspectionView, JobView, UploadTicket } from "@justdownload/core";

/**
 * Typed client for the web app's /api/v1 routes. Responses are schema-checked at the boundary:
 * the fields the UI relies on must be present and well-typed, otherwise the call fails loudly
 * instead of rendering half-understood data.
 */
export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly action: string | null, readonly retryable: boolean, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const ErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), action: z.string().optional(), retryable: z.boolean().optional() }) });

const OptionSchema = z.object({
  id: z.string(), kind: z.enum(["video", "audio"]), operation: z.string(), extension: z.string(), label: z.string(), details: z.array(z.string()),
  resolution: z.number().nullable(), lossy: z.boolean(), isSourceFormat: z.boolean(), exactSizeBytes: z.number().nullable(), note: z.string().nullable(),
}).passthrough();

const InspectionSchema = z.object({
  id: z.string().nullable(),
  mode: z.enum(["full", "basic", "policy"]),
  download_allowed: z.boolean(),
  provider: z.object({ id: z.string(), displayName: z.string(), download: z.string(), downloadLabel: z.string(), reason: z.string() }).passthrough(),
  options: z.array(OptionSchema),
  notices: z.array(z.string()),
}).passthrough();

const JobSchema = z.object({
  id: z.string(), state: z.string(), stage_label: z.string(), percent: z.number().nullable(),
  downloaded_bytes: z.number().nullable(), total_bytes: z.number().nullable(), speed_bytes_per_second: z.number().nullable(), eta_seconds: z.number().nullable(),
  filename: z.string(), download_url: z.string().nullable(), events_url: z.string().nullable(),
}).passthrough();

const TicketSchema = z.object({ upload_url: z.string().url(), max_bytes: z.number(), expires_at: z.string() });

async function call<T>(path: string, init: RequestInit, schema: z.ZodType): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }, cache: "no-store" });
  } catch {
    throw new ApiError("NETWORK", "You appear to be offline, or the server couldn't be reached.", "Check your connection and try again.", true, 0);
  }
  if (res.status === 204) return null as T;
  let json: unknown;
  try { json = await res.json(); } catch { throw new ApiError("INTERNAL", "The server sent an unreadable response.", "Try again in a moment.", true, res.status); }
  if (!res.ok) {
    const e = ErrorSchema.safeParse(json);
    if (e.success) throw new ApiError(e.data.error.code, e.data.error.message, e.data.error.action ?? null, e.data.error.retryable ?? false, res.status);
    throw new ApiError("INTERNAL", "Something went wrong.", "Try again in a moment.", true, res.status);
  }
  const ok = schema.safeParse(json);
  if (!ok.success) throw new ApiError("INTERNAL", "The server sent an unexpected response.", "Try again in a moment.", true, res.status);
  return json as T;
}

export const api = {
  inspect: (url: string) => call<InspectionView>("/api/v1/inspections", { method: "POST", body: JSON.stringify({ url }) }, InspectionSchema),
  createJob: (body: { inspection_id: string; option_id: string; filename?: string; idempotency_key: string }) =>
    call<JobView>("/api/v1/jobs", { method: "POST", body: JSON.stringify(body) }, JobSchema),
  job: (id: string) => call<JobView>(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: "GET" }, JobSchema),
  cancel: (id: string) => call<JobView>(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }, JobSchema),
  remove: (id: string) => call<null>(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }, z.null()),
  uploadTicket: () => call<UploadTicket>("/api/v1/uploads/ticket", { method: "POST" }, TicketSchema),
};

export function parseJob(json: unknown): JobView | null {
  return JobSchema.safeParse(json).success ? (json as JobView) : null;
}

/** Upload a file straight to the worker with real byte progress (XHR exposes upload progress). */
export function uploadFile(ticket: UploadTicket, file: File, onProgress: (sent: number, total: number) => void, signal: AbortSignal): Promise<InspectionView> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.upload_url);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    xhr.onerror = () => reject(new ApiError("NETWORK", "The upload was interrupted.", "Check your connection and try again.", true, 0));
    xhr.onabort = () => reject(new ApiError("CANCELLED", "Upload cancelled.", null, false, 0));
    xhr.onload = () => {
      let json: unknown = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300 && InspectionSchema.safeParse(json).success) return resolve(json as InspectionView);
      const e = ErrorSchema.safeParse(json);
      if (e.success) return reject(new ApiError(e.data.error.code, e.data.error.message, e.data.error.action ?? null, e.data.error.retryable ?? false, xhr.status));
      reject(new ApiError("UPLOAD_INVALID", "The upload failed.", "Try again.", true, xhr.status));
    };
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
