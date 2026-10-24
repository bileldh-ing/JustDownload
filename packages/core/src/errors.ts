/**
 * Machine-readable error codes shared by the web app, the worker API and the UI.
 * Every code carries a user-safe message, whether retrying can help, and a next action.
 * Internal details (addresses, command lines, stack traces) never go into these messages.
 */
export const ERROR_CATALOG = {
  INVALID_URL: { status: 400, retryable: false, message: "That doesn't look like a valid web address.", action: "Check the link and paste the full address, starting with https://." },
  UNSUPPORTED_SCHEME: { status: 400, retryable: false, message: "Only http:// and https:// links can be inspected.", action: "Paste a web link that starts with https://." },
  URL_CREDENTIALS_NOT_ALLOWED: { status: 400, retryable: false, message: "Links that contain a username or password are not accepted.", action: "Remove the credentials from the link. JustDownload never handles private logins." },
  UNSAFE_DESTINATION: { status: 400, retryable: false, message: "This link points to a private, local or reserved network address, which JustDownload does not access.", action: "Use a publicly reachable media link." },
  PORT_NOT_ALLOWED: { status: 400, retryable: false, message: "This link uses a network port that is not allowed.", action: "Use a standard https:// link (port 443) or http:// (port 80)." },
  DNS_RESOLUTION_FAILED: { status: 422, retryable: true, message: "The website's address could not be resolved.", action: "Check the link for typos, then try again." },
  TOO_MANY_REDIRECTS: { status: 422, retryable: false, message: "The link redirected too many times.", action: "Paste the final, direct link to the media file." },
  UNSAFE_REDIRECT: { status: 422, retryable: false, message: "The link redirected to an address JustDownload does not access.", action: "Paste a direct, public link to the media file." },
  SOURCE_UNREACHABLE: { status: 502, retryable: true, message: "The source server could not be reached.", action: "Try again in a moment. If it keeps failing, the source may be offline." },
  SOURCE_TIMEOUT: { status: 504, retryable: true, message: "The source server took too long to respond.", action: "Try again in a moment." },
  SOURCE_HTTP_ERROR: { status: 502, retryable: false, message: "The source server refused the request or the file was not found.", action: "Check that the link still works in your browser and is publicly accessible." },
  SOURCE_NOT_MEDIA: { status: 422, retryable: false, message: "This link is a web page or document, not a media file.", action: "Paste a direct link to an audio or video file, or upload the file instead." },
  STREAMING_MANIFEST_UNSUPPORTED: { status: 422, retryable: false, message: "This is a streaming playlist (HLS/DASH). Streaming playlists are not processed in this version.", action: "Use a direct link to a single media file, or the source's official download option." },
  SOURCE_TOO_LARGE: { status: 413, retryable: false, message: "This file is larger than this deployment's size limit.", action: "Use a smaller file. Self-hosters can raise the limit in the worker configuration." },
  SOURCE_TOO_LONG: { status: 413, retryable: false, message: "This media is longer than this deployment's duration limit.", action: "Use a shorter file. Self-hosters can raise the limit in the worker configuration." },
  PROBE_FAILED: { status: 422, retryable: false, message: "The file could not be read as audio or video.", action: "Make sure the file is a complete, valid media file." },
  PROVIDER_DOWNLOAD_UNAVAILABLE: { status: 403, retryable: false, message: "This source does not currently support downloading through JustDownload.", action: "Use the source's official export or download option." },
  PROVIDER_UNAVAILABLE: { status: 503, retryable: true, message: "This source is temporarily unavailable.", action: "Try again later." },
  WORKER_NOT_CONFIGURED: { status: 503, retryable: false, message: "No processing worker is connected to this deployment, so files cannot be downloaded or converted here.", action: "Basic link inspection still works. The operator must connect a JustDownload worker to enable processing." },
  WORKER_UNAVAILABLE: { status: 503, retryable: true, message: "The processing worker is not responding.", action: "Try again in a moment." },
  INSPECTION_NOT_FOUND: { status: 404, retryable: false, message: "This inspection has expired or does not exist.", action: "Inspect the link again." },
  OPTION_NOT_AVAILABLE: { status: 422, retryable: false, message: "That output option is not available for this source.", action: "Choose one of the options listed for this file." },
  INVALID_FILENAME: { status: 400, retryable: false, message: "That file name can't be used.", action: "Use a shorter name without slashes or special characters." },
  JOB_NOT_FOUND: { status: 404, retryable: false, message: "This job doesn't exist or has expired.", action: "Start a new download." },
  JOB_NOT_READY: { status: 409, retryable: true, message: "The file isn't ready yet.", action: "Wait for processing to finish." },
  JOB_NOT_CANCELLABLE: { status: 409, retryable: false, message: "This job has already finished and can't be cancelled.", action: "You can delete it instead." },
  ARTIFACT_EXPIRED: { status: 410, retryable: false, message: "This file has expired and was deleted.", action: "Start the download again." },
  LINK_EXPIRED: { status: 403, retryable: false, message: "This download link has expired.", action: "Open the job page again to get a fresh link." },
  CAPACITY_EXCEEDED: { status: 503, retryable: true, message: "The service is at capacity right now.", action: "Try again in a few minutes." },
  RATE_LIMITED: { status: 429, retryable: true, message: "Too many requests in a short time.", action: "Wait a minute and try again." },
  UPLOAD_INVALID: { status: 400, retryable: false, message: "The uploaded file could not be accepted.", action: "Upload a complete audio or video file within the size limit." },
  CONVERSION_FAILED: { status: 500, retryable: true, message: "Conversion failed.", action: "Try again, or pick a different output format." },
  OUTPUT_VALIDATION_FAILED: { status: 500, retryable: false, message: "The output file failed verification, so it was discarded.", action: "Try a different output format. If it keeps happening, the source file may be damaged." },
  CANCELLED: { status: 409, retryable: false, message: "This job was cancelled.", action: "Start a new download whenever you like." },
  UNAUTHORIZED: { status: 401, retryable: false, message: "Not authorized.", action: "Reload the page and try again." },
  BAD_REQUEST: { status: 400, retryable: false, message: "The request was not valid.", action: "Reload the page and try again." },
  INTERNAL: { status: 500, retryable: true, message: "Something went wrong on our side.", action: "Try again in a moment." },
} as const satisfies Record<string, { status: number; retryable: boolean; message: string; action: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export class JdError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly action: string;
  /** Operator-only detail. Logged (redacted) but never sent to clients. */
  readonly internal?: string;
  constructor(code: ErrorCode, opts: { internal?: string; message?: string; retryable?: boolean } = {}) {
    const entry = ERROR_CATALOG[code];
    super(opts.message ?? entry.message);
    this.name = "JdError";
    this.code = code;
    this.status = entry.status;
    this.retryable = opts.retryable ?? entry.retryable;
    this.action = entry.action;
    this.internal = opts.internal;
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; request_id: string; retryable: boolean; action: string };
}

export function errorBody(err: unknown, requestId: string): { status: number; body: ErrorBody } {
  const e = err instanceof JdError ? err : new JdError("INTERNAL");
  return { status: e.status, body: { error: { code: e.code, message: e.message, request_id: requestId, retryable: e.retryable, action: e.action } } };
}

export function isRetryable(code: ErrorCode): boolean {
  return ERROR_CATALOG[code].retryable;
}
