/**
 * Job state machine. Only the transitions listed here are legal; the worker persists every
 * transition before publishing it, and a job is only `ready` after its output was validated.
 */
export const JOB_STATES = [
  "created", "validating", "inspecting", "queued", "downloading", "merging", "converting", "validating_output", "ready",
  "failed", "cancelled", "rejected_by_policy", "expired",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<JobState> = new Set(["ready", "failed", "cancelled", "rejected_by_policy", "expired"]);
export const ACTIVE_STATES: ReadonlySet<JobState> = new Set(["created", "validating", "inspecting", "queued", "downloading", "merging", "converting", "validating_output"]);

const T: Record<JobState, readonly JobState[]> = {
  created: ["validating", "failed", "cancelled", "rejected_by_policy"],
  validating: ["inspecting", "queued", "failed", "cancelled", "rejected_by_policy"],
  inspecting: ["queued", "failed", "cancelled", "rejected_by_policy"],
  // queued → queued is a retry re-enqueue after a transient failure (attempt counter increments).
  queued: ["downloading", "converting", "validating_output", "queued", "failed", "cancelled", "expired"],
  downloading: ["merging", "converting", "validating_output", "queued", "failed", "cancelled"],
  merging: ["converting", "validating_output", "queued", "failed", "cancelled"],
  converting: ["validating_output", "queued", "failed", "cancelled"],
  validating_output: ["ready", "queued", "failed", "cancelled"],
  ready: ["expired"],
  failed: ["expired"],
  cancelled: ["expired"],
  rejected_by_policy: ["expired"],
  expired: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return T[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(readonly from: JobState, readonly to: JobState) {
    super(`illegal job transition ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export const STAGE_LABEL: Record<JobState, string> = {
  created: "Created",
  validating: "Checking request",
  inspecting: "Inspecting source",
  queued: "Waiting for a worker",
  downloading: "Downloading source",
  merging: "Merging audio and video",
  converting: "Converting",
  validating_output: "Verifying output",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
  rejected_by_policy: "Not permitted",
  expired: "Expired",
};

/** Typed progress event. Every numeric field is null when the value is not actually known. */
export interface ProgressEvent {
  job_id: string;
  state: JobState;
  stage_label: string;
  percent: number | null;
  downloaded_bytes: number | null;
  total_bytes: number | null;
  speed_bytes_per_second: number | null;
  eta_seconds: number | null;
  message_code: string | null;
  updated_at: string;
}

/**
 * Overall percent is only reported for the stage that can measure it. It is never 100 unless the
 * job is `ready`, so "100%" always means a verified file exists.
 */
export function clampStagePercent(state: JobState, percent: number | null): number | null {
  if (state === "ready") return 100;
  if (percent == null || !Number.isFinite(percent)) return null;
  return Math.max(0, Math.min(99, Math.floor(percent)));
}
