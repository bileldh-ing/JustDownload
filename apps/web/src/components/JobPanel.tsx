"use client";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Clock, Download, FileCheck2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, formatDuration, formatEta, formatSpeed, type JobView } from "@justdownload/core";
import { ApiError, api, parseJob } from "@/lib/api";
import { Button, Chip, IconChip, buttonClass } from "./ui";

const STEPS = [
  { key: "queued", label: "Queued", states: ["created", "validating", "inspecting", "queued"] },
  { key: "downloading", label: "Download", states: ["downloading", "merging"] },
  { key: "converting", label: "Convert", states: ["converting"] },
  { key: "validating_output", label: "Verify", states: ["validating_output"] },
  { key: "ready", label: "Ready", states: ["ready"] },
] as const;

const TERMINAL = new Set(["ready", "failed", "cancelled", "rejected_by_policy", "expired"]);

function stepIndex(state: string): number {
  return STEPS.findIndex((s) => (s.states as readonly string[]).includes(state));
}

/**
 * Processing + ready view. State comes only from the backend: SSE from the worker when it's
 * reachable, polling through the web API otherwise. Reloading the page restores the real state.
 */
export function JobPanel({ id }: { id: string }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<"cancel" | "delete" | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [announce, setAnnounce] = useState("");
  const lastState = useRef<string | null>(null);

  const accept = useCallback((j: JobView) => {
    setJob(j);
    if (j.state !== lastState.current) {
      lastState.current = j.state;
      setAnnounce(j.state === "ready" ? "Your file is ready to download." : j.state === "failed" ? `Failed: ${j.error?.message ?? ""}` : j.stage_label);
    }
  }, []);

  useEffect(() => {
    let stop = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (stop) return;
      try {
        const j = await api.job(id);
        accept(j);
        setError(null);
        if (TERMINAL.has(j.state)) {
          // Ready links are short-lived: refresh them before they expire while the page is open.
          if (j.state === "ready") timer = setTimeout(poll, 5 * 60_000);
          return;
        }
        if (j.events_url && !es && typeof EventSource !== "undefined") {
          es = new EventSource(j.events_url);
          es.addEventListener("progress", (ev) => {
            const parsed = parseJob(JSON.parse((ev as MessageEvent).data));
            if (parsed) { accept(parsed); if (TERMINAL.has(parsed.state)) { es?.close(); void poll(); } }
          });
          es.onerror = () => { es?.close(); es = null; timer = setTimeout(poll, 1000); };
          timer = setTimeout(poll, 10_000); // safety net alongside SSE
          return;
        }
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError("INTERNAL", "Lost contact with the server.", null, true, 0);
        setError(err);
        if (!err.retryable) return;
      }
      timer = setTimeout(poll, es ? 10_000 : 1000);
    };
    void poll();
    return () => { stop = true; es?.close(); if (timer) clearTimeout(timer); };
  }, [id, accept]);

  const cancel = async () => {
    setBusy("cancel");
    try { accept(await api.cancel(id)); } catch (e) { setError(e as ApiError); } finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("delete");
    try { await api.remove(id); setDeleted(true); } catch (e) { setError(e as ApiError); } finally { setBusy(null); }
  };

  if (deleted) {
    return (
      <Shell>
        <div className="flex items-start gap-3"><IconChip tone="mint"><Trash2 size={18} /></IconChip><div><h1 className="text-[18px] font-bold">Deleted</h1><p className="mt-1 text-[13.5px] text-muted">The job and its file were removed from the worker.</p><Link href="/" className={buttonClass("primary", "sm", "mt-3")}>New download</Link></div></div>
      </Shell>
    );
  }
  if (!job) {
    return (
      <Shell>
        {error ? (
          <div role="alert" className="flex items-start gap-3"><IconChip tone="danger"><AlertTriangle size={18} /></IconChip><div><h1 className="text-[17px] font-bold">{error.message}</h1>{error.action && <p className="mt-1 text-[13.5px] text-muted">{error.action}</p>}<Link href="/" className={buttonClass("secondary", "sm", "mt-3")}>Back to downloader</Link></div></div>
        ) : (
          <div aria-busy="true"><div className="jd-skeleton h-5 w-1/2" /><div className="jd-skeleton mt-4 h-2 w-full" /><div className="jd-skeleton mt-3 h-3 w-1/3" /></div>
        )}
      </Shell>
    );
  }

  const idx = stepIndex(job.state);
  const active = !TERMINAL.has(job.state);
  const pct = job.percent;
  const metrics = [
    job.downloaded_bytes != null ? `${formatBytes(job.downloaded_bytes)}${job.total_bytes ? ` of ${formatBytes(job.total_bytes)}` : ""}` : null,
    formatSpeed(job.speed_bytes_per_second),
    formatEta(job.eta_seconds),
    job.message_code?.startsWith("SPEED_") ? `${job.message_code.slice(6)} realtime` : null,
  ].filter(Boolean);

  return (
    <Shell>
      <div aria-live="polite" className="sr-only" data-testid="job-announcer">{announce}</div>
      <div className="flex items-start gap-3">
        <IconChip tone={job.state === "ready" ? "mint" : job.state === "failed" || job.state === "rejected_by_policy" ? "danger" : job.state === "cancelled" || job.state === "expired" ? "warn" : "accent"} size={44}>
          {job.state === "ready" ? <FileCheck2 size={20} /> : job.state === "failed" ? <AlertTriangle size={20} /> : job.state === "cancelled" ? <Ban size={20} /> : job.state === "expired" ? <Clock size={20} /> : <Loader2 size={20} className="animate-spin" />}
        </IconChip>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-muted">{job.option.label}</p>
          <h1 className="truncate text-[19px] font-bold tracking-tight" title={job.filename} data-testid="job-filename">{job.filename}</h1>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip tone={job.state === "ready" ? "ok" : job.state === "failed" ? "danger" : active ? "accent" : "warn"}><span data-testid="job-state">{job.stage_label}</span></Chip>
            {job.source.host && <Chip>{job.source.host}</Chip>}
            {job.source.kind === "upload" && <Chip>Uploaded file</Chip>}
            {job.attempts > 1 && <Chip tone="info">Attempt {job.attempts}</Chip>}
          </div>
        </div>
      </div>

      {/* stage stepper */}
      <ol className="mt-6 grid grid-cols-5 gap-1.5" aria-label="Processing stages">
        {STEPS.map((s, i) => {
          const skipped = job.option.operation === "original" && s.key === "converting";
          const done = job.state === "ready" || (idx > i && idx >= 0);
          const current = idx === i && active;
          return (
            <li key={s.key} className="min-w-0" aria-current={current ? "step" : undefined}>
              <div className={`h-1.5 rounded-full ${done ? "bg-ok" : current ? "jd-accent-fill" : "bg-surface-hover"} ${skipped ? "opacity-40" : ""}`} />
              <p className={`mt-1.5 truncate text-[11.5px] font-semibold ${current ? "text-fg" : done ? "text-muted" : "text-faint"}`}>{done ? <CheckCircle2 size={11} className="me-1 inline text-ok" aria-hidden /> : null}{s.label}{skipped ? " (n/a)" : ""}</p>
            </li>
          );
        })}
      </ol>

      {active && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[14px] font-semibold">{job.stage_label}</p>
            <p className="font-mono text-[13px] text-muted" data-testid="job-percent">{pct != null ? `${Math.floor(pct)}%` : "measuring…"}</p>
          </div>
          <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-surface-inner" role="progressbar" aria-label={job.stage_label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct != null ? Math.floor(pct) : undefined} aria-valuetext={pct == null ? "In progress, percentage unknown" : undefined}>
            {pct != null ? <div className="jd-accent-fill h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%` }} /> : <div className="jd-accent-fill jd-indeterminate absolute inset-y-0 w-1/3 rounded-full" />}
          </div>
          <p className="mt-2 min-h-5 font-mono text-[12px] text-muted">{metrics.length ? metrics.join(" · ") : job.state === "queued" ? "Waiting for a free worker slot" : "\u00a0"}</p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="danger" onClick={() => void cancel()} disabled={busy !== null} data-testid="cancel-button">{busy === "cancel" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Ban size={14} aria-hidden />} Cancel</Button>
          </div>
        </div>
      )}

      {job.state === "ready" && job.artifact && (
        <div className="mt-6" data-testid="ready-panel">
          <dl className="glass-inner grid gap-x-6 gap-y-2.5 p-4 text-[13px] sm:grid-cols-2">
            <Fact k="Size" v={formatBytes(job.artifact.size_bytes)} />
            <Fact k="Type" v={`${job.artifact.container.toUpperCase()} · ${job.artifact.mime_type}`} />
            <Fact k="Duration" v={formatDuration(job.artifact.duration_sec)} />
            <Fact k="Streams" v={[job.artifact.video_codec && `${job.artifact.video_codec}${job.artifact.width ? ` ${job.artifact.width}×${job.artifact.height}` : ""}`, job.artifact.audio_codec].filter(Boolean).join(" + ") || "—"} />
            <div className="sm:col-span-2"><Fact k="SHA-256 (verified)" v={job.artifact.sha256} mono /></div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {job.download_url ? (
              <a href={job.download_url} className={buttonClass("primary", "lg")} data-testid="download-link"><Download size={18} aria-hidden /> Download file</a>
            ) : (
              <p className="text-[13px] text-warn">The worker has no public URL configured, so the file can&apos;t be handed to your browser. The operator must set the worker&apos;s PUBLIC_URL.</p>
            )}
            <Button variant="ghost" onClick={() => void remove()} disabled={busy !== null}><Trash2 size={15} aria-hidden /> Delete now</Button>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted"><Clock size={13} aria-hidden /> Deleted automatically at {new Date(job.artifact.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Download links expire after 10 minutes and refresh while this page is open.</p>
        </div>
      )}

      {(job.state === "failed" || job.state === "rejected_by_policy") && job.error && (
        <div role="alert" className="mt-6 rounded-[18px] border border-danger/40 bg-danger/10 p-4" data-testid="job-error">
          <p className="text-[14.5px] font-bold text-danger">{job.error.message}</p>
          <p className="mt-1 text-[13px] text-muted">{job.error.action}</p>
          <p className="mt-2 font-mono text-[11px] text-faint">code {job.error.code}</p>
          <Link href="/" className={buttonClass("secondary", "sm", "mt-3")}><RotateCcw size={14} aria-hidden /> Start over</Link>
        </div>
      )}
      {job.state === "cancelled" && <p className="mt-6 text-[13.5px] text-muted">This job was cancelled and its temporary files were removed. <Link href="/" className="text-accent underline underline-offset-2">Start a new download</Link>.</p>}
      {job.state === "expired" && <p className="mt-6 text-[13.5px] text-muted">This file passed its retention period and was deleted. <Link href="/" className="text-accent underline underline-offset-2">Start again</Link>.</p>}
      {error && job && <p role="status" className="mt-4 text-[12.5px] text-warn">{error.message} Retrying…</p>}
    </Shell>
  );
}

function Fact({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-[11.5px] font-medium text-faint">{k}</dt><dd className={`break-all font-semibold text-fg ${mono ? "font-mono text-[11.5px]" : ""}`}>{v}</dd></div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-fg"><ArrowLeft size={15} aria-hidden /> Downloader</Link>
      <section className="glass rounded-[var(--radius)] p-5 sm:p-7">{children}</section>
    </div>
  );
}
