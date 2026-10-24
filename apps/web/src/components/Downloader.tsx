"use client";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle, ArrowRight, AudioLines, CheckCircle2, ClipboardPaste, ExternalLink, FileAudio, FileVideo, Film, Info, Link2, Loader2, RotateCcw,
  ScanSearch, ShieldAlert, ShieldCheck, Upload, X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  JdError, codecName, formatBytes, formatDuration, matchPublicProvider, normalizeUrl, sanitizeBaseName,
  type InspectionView, type OutputOption, type PublicProvider,
} from "@justdownload/core";
import { ApiError, api, uploadFile } from "@/lib/api";
import type { AppStatus } from "@/server/status";
import { Button, Chip, IconChip, Spinner, buttonClass } from "./ui";

type Tab = "video" | "audio" | "local";

type Phase =
  | { kind: "idle" }
  | { kind: "inspecting" }
  | { kind: "inspected"; view: InspectionView }
  | { kind: "error"; error: ApiError };

interface LocalCheck {
  state: "empty" | "invalid" | "unsupported_scheme" | "unsafe" | "credentials" | "port" | "ok";
  message: string;
  provider: PublicProvider | null;
}

const LOCAL_MESSAGES: Record<string, LocalCheck["state"]> = {
  INVALID_URL: "invalid", UNSUPPORTED_SCHEME: "unsupported_scheme", UNSAFE_DESTINATION: "unsafe", URL_CREDENTIALS_NOT_ALLOWED: "credentials", PORT_NOT_ALLOWED: "port",
};

/** Instant client-side check for feedback while typing. The server re-validates everything. */
function checkLocally(input: string, providers: readonly PublicProvider[], allowPrivateNetwork: boolean): LocalCheck {
  if (!input.trim()) return { state: "empty", message: "Paste a link to an audio or video file you own or may download.", provider: null };
  try {
    const u = normalizeUrl(input, { allowPrivateNetwork });
    return { state: "ok", message: "", provider: matchPublicProvider(u.hostname, u.pathname, providers) };
  } catch (e) {
    const code = e instanceof JdError ? e.code : "INVALID_URL";
    return { state: LOCAL_MESSAGES[code] ?? "invalid", message: e instanceof JdError ? e.message : "That doesn't look like a valid web address.", provider: null };
  }
}

function newKey(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function canDownload(p: PublicProvider | null) {
  return !!p && (p.download === "enabled" || p.download === "authorized_download");
}

export function Downloader({ status }: { status: AppStatus }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const inputId = useId();
  const hintId = useId();
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [tab, setTab] = useState<Tab>("video");
  const [selected, setSelected] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<ApiError | null>(null);
  const [upload, setUpload] = useState<{ name: string; sent: number; total: number } | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const idemKey = useRef<string>(newKey());
  const processing = status.worker === "online";

  const check = useMemo(() => checkLocally(url, status.providers, status.allowPrivateNetwork), [url, status.providers, status.allowPrivateNetwork]);
  const showLocalError = touched && check.state !== "ok" && check.state !== "empty";

  const view = phase.kind === "inspected" ? phase.view : null;
  const videoOptions = useMemo(() => view?.options.filter((o) => o.kind === "video") ?? [], [view]);
  const audioOptions = useMemo(() => view?.options.filter((o) => o.kind === "audio") ?? [], [view]);


  const acceptView = useCallback((v: InspectionView) => {
    setPhase({ kind: "inspected", view: v });
    const firstVideo = v.options.find((o) => o.kind === "video");
    const firstAudio = v.options.find((o) => o.kind === "audio");
    const nextTab: Tab = firstVideo ? "video" : "audio";
    setTab((t) => (t === "local" && v.source.kind === "upload" ? nextTab : t === "local" ? "local" : nextTab));
    setSelected((nextTab === "video" ? firstVideo : firstAudio)?.id ?? null);
    const title = v.media?.title ?? v.source.filename ?? "";
    setFilename(sanitizeBaseName(title.replace(/\.[A-Za-z0-9]{1,5}$/, "")));
    idemKey.current = newKey();
    setStartError(null);
  }, []);

  const inspect = useCallback(async () => {
    setTouched(true);
    if (check.state !== "ok") return;
    setPhase({ kind: "inspecting" });
    setStartError(null);
    try {
      acceptView(await api.inspect(url));
    } catch (e) {
      setPhase({ kind: "error", error: e instanceof ApiError ? e : new ApiError("INTERNAL", "Something went wrong.", "Try again.", true, 0) });
    }
  }, [acceptView, check.state, url]);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setUrl(text.trim()); setTouched(true); }
    } catch { /* clipboard permission denied: user can paste manually */ }
  };

  const onFile = async (file: File) => {
    if (!processing) return;
    const max = status.limits?.max_upload_bytes ?? 0;
    if (max && file.size > max) {
      setPhase({ kind: "error", error: new ApiError("SOURCE_TOO_LARGE", `This file is ${formatBytes(file.size)}; the limit here is ${formatBytes(max)}.`, "Use a smaller file.", false, 413) });
      return;
    }
    uploadAbort.current?.abort();
    const ac = new AbortController();
    uploadAbort.current = ac;
    setUpload({ name: file.name, sent: 0, total: file.size });
    setPhase({ kind: "inspecting" });
    try {
      const ticket = await api.uploadTicket();
      const v = await uploadFile(ticket, file, (sent, total) => setUpload({ name: file.name, sent, total }), ac.signal);
      setUpload(null);
      acceptView(v);
      setTab(v.options.some((o) => o.kind === "video") ? "video" : "audio");
    } catch (e) {
      setUpload(null);
      setPhase(e instanceof ApiError && e.code === "CANCELLED" ? { kind: "idle" } : { kind: "error", error: e instanceof ApiError ? e : new ApiError("UPLOAD_INVALID", "The upload failed.", "Try again.", true, 0) });
    }
  };

  const start = async () => {
    if (!view?.id || !selected) return;
    setStarting(true);
    setStartError(null);
    try {
      const job = await api.createJob({ inspection_id: view.id, option_id: selected, filename: filename.trim() || undefined, idempotency_key: idemKey.current });
      router.push(`/jobs/${job.id}`);
    } catch (e) {
      setStartError(e instanceof ApiError ? e : new ApiError("INTERNAL", "Couldn't start the job.", "Try again.", true, 0));
      setStarting(false);
    }
  };

  const reset = () => {
    setPhase({ kind: "idle" });
    setUrl("");
    setTouched(false);
    setSelected(null);
    setStartError(null);
  };

  const options = tab === "video" ? videoOptions : tab === "audio" ? audioOptions : [];
  const selectedOption = view?.options.find((o) => o.id === selected) ?? null;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ URL form */}
      <section id="inspect" aria-labelledby="dl-title" className="glass scroll-mt-24 rounded-[var(--radius)] p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <IconChip tone="accent" size={44}><ScanSearch size={20} /></IconChip>
          <div className="min-w-0">
            <h1 id="dl-title" className="text-[22px] font-bold leading-tight tracking-tight sm:text-[26px]">Paste a link. <span className="jd-text-grad">See what&apos;s really there.</span></h1>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">Enter a link to media you own or are authorized to download. Source compatibility and available outputs vary, and every option shown comes from the actual file.</p>
          </div>
        </div>

        <form className="mt-5" onSubmit={(e) => { e.preventDefault(); void inspect(); }} noValidate>
          <label htmlFor={inputId} className="sr-only">Media link</label>
          <div className={`jd-transition flex items-center gap-1.5 rounded-full border bg-surface-inner p-1.5 ps-4 focus-within:ring-4 ${showLocalError ? "border-danger/60 focus-within:ring-danger/15" : "border-line-strong focus-within:border-accent-strong focus-within:ring-[color-mix(in_srgb,var(--accent-strong)_18%,transparent)]"}`}>
            <Link2 size={17} className="shrink-0 text-faint" aria-hidden />
            <input
              id={inputId} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://example.com/media/clip.mp4"
              value={url} onChange={(e) => { setUrl(e.target.value); if (phase.kind === "error") setPhase({ kind: "idle" }); }} onBlur={() => url && setTouched(true)}
              aria-invalid={showLocalError} aria-describedby={hintId} data-testid="url-input"
              className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-fg placeholder:text-faint focus:outline-none"
            />
            {url ? (
              <button type="button" onClick={() => { setUrl(""); setTouched(false); }} aria-label="Clear link" className="jd-press grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-fg"><X size={16} aria-hidden /></button>
            ) : (
              <button type="button" onClick={() => void paste()} className="jd-press hidden h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted hover:bg-surface-hover hover:text-fg sm:inline-flex"><ClipboardPaste size={15} aria-hidden /> Paste</button>
            )}
            <button type="submit" disabled={phase.kind === "inspecting"} className={buttonClass("primary", "md", "h-10 shrink-0 px-4 sm:px-5")} data-testid="inspect-button">
              {phase.kind === "inspecting" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ScanSearch size={16} aria-hidden />}
              <span className="hidden min-[420px]:inline">{phase.kind === "inspecting" ? "Inspecting" : "Inspect link"}</span>
            </button>
          </div>
          <div id={hintId} className="mt-2.5 flex min-h-6 flex-wrap items-center gap-2 px-1 text-[12.5px]" aria-live="polite">
            {showLocalError ? (
              <span role="alert" className="inline-flex items-center gap-1.5 font-medium text-danger" data-testid="url-error"><AlertTriangle size={14} aria-hidden /> {check.message}</span>
            ) : check.state === "ok" && check.provider ? (
              <>
                <Chip tone={canDownload(check.provider) ? "accent" : "warn"}>
                  {canDownload(check.provider) ? <ShieldCheck size={12} aria-hidden /> : <ShieldAlert size={12} aria-hidden />}
                  {check.provider.displayName}
                </Chip>
                <span className="text-muted">{canDownload(check.provider) ? "Looks valid. Inspect to check the file." : `${check.provider.downloadLabel}: this source isn't downloaded here.`}</span>
              </>
            ) : (
              <span className="text-muted">{check.message}</span>
            )}
          </div>
        </form>

        <div className="mt-3 flex flex-wrap gap-2 px-1" aria-label="Capabilities">
          <Chip tone="ok"><CheckCircle2 size={12} aria-hidden /> Direct media links</Chip>
          <Chip tone={processing ? "ok" : "neutral"}>{processing ? <CheckCircle2 size={12} aria-hidden /> : <Info size={12} aria-hidden />} Local file conversion{processing ? "" : " (needs worker)"}</Chip>
          <Chip tone="warn"><ShieldAlert size={12} aria-hidden /> Restricted platforms: official export only</Chip>
        </div>
      </section>

      {/* ------------------------------------------------------- results area */}
      <AnimatePresence mode="wait" initial={false}>
        {phase.kind === "inspecting" && (
          <motion.section key="loading" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
            className="glass rounded-[var(--radius)] p-5 sm:p-6" aria-busy="true" aria-live="polite">
            {upload ? (
              <div>
                <div className="flex items-center justify-between gap-3 text-[13.5px]">
                  <span className="truncate font-semibold">Uploading {upload.name}</span>
                  <span className="shrink-0 font-mono text-muted">{formatBytes(upload.sent)} / {formatBytes(upload.total)}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-inner" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor((upload.sent / Math.max(1, upload.total)) * 100)}>
                  <div className="jd-accent-fill h-full rounded-full transition-[width] duration-200" style={{ width: `${(upload.sent / Math.max(1, upload.total)) * 100}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between text-[12.5px] text-muted">
                  <span>{upload.sent >= upload.total ? "Analysing with FFprobe…" : "Sending to the processing worker"}</span>
                  <Button size="sm" variant="ghost" onClick={() => uploadAbort.current?.abort()}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="flex items-center gap-2 text-[13.5px] font-semibold"><Spinner className="text-accent" /> Inspecting the link…</p>
                <div className="mt-4 flex gap-4">
                  <div className="jd-skeleton h-20 w-28 shrink-0" />
                  <div className="flex-1 space-y-2.5"><div className="jd-skeleton h-4 w-3/4" /><div className="jd-skeleton h-3 w-1/2" /><div className="jd-skeleton h-3 w-2/3" /></div>
                </div>
              </div>
            )}
          </motion.section>
        )}

        {phase.kind === "error" && (
          <motion.section key="error" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="glass rounded-[var(--radius)] p-5 sm:p-6">
            <div ref={(el) => { errorRef.current = el; el?.focus(); }} tabIndex={-1} role="alert" className="flex items-start gap-3 outline-none" data-testid="inspect-error">
              <IconChip tone="danger" size={40}><AlertTriangle size={18} /></IconChip>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15.5px] font-bold">{phase.error.message}</h2>
                {phase.error.action && <p className="mt-1 text-[13.5px] text-muted">{phase.error.action}</p>}
                <p className="mt-2 font-mono text-[11px] text-faint">code {phase.error.code}</p>
                <div className="mt-3 flex gap-2">
                  {phase.error.retryable && <Button size="sm" variant="primary" onClick={() => void inspect()}><RotateCcw size={14} aria-hidden /> Try again</Button>}
                  <Button size="sm" variant="ghost" onClick={reset}>Start over</Button>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {view && (
          <motion.section key={`result-${view.id ?? view.inspected_at}`} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="glass rounded-[var(--radius)] p-4 sm:p-6" aria-labelledby="result-title" data-testid="inspection-result" data-mode={view.mode}>
            <Preview view={view} titleRef={resultRef} />

            {view.mode === "policy" && <PolicyCard view={view} />}
            {view.mode === "basic" && <BasicCard view={view} />}

            {view.mode === "full" && (
              <div className="mt-5">
                <div role="tablist" aria-label="Output type" className="flex gap-1 rounded-full border border-line bg-surface-inner p-1">
                  {([["video", "Video", "Video", Film, videoOptions.length], ["audio", "MP3 / Audio", "Audio", AudioLines, audioOptions.length], ["local", "Convert local file", "Local file", Upload, -1]] as const).map(([id, label, short, Icon, n]) => (
                    <button key={id} role="tab" type="button" aria-selected={tab === id} aria-controls={`panel-${id}`} id={`tab-${id}`} data-testid={`tab-${id}`}
                      onClick={() => { setTab(id); const first = (id === "video" ? videoOptions : audioOptions)[0]; if (id !== "local") setSelected(first?.id ?? null); }}
                      className={`jd-press relative flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-[12.5px] font-semibold sm:text-[13px] ${tab === id ? "text-accent-ink" : "text-muted hover:text-fg"}`}>
                      {tab === id && <motion.span layoutId="out-tab" aria-hidden className="jd-accent-fill jd-accent-glow absolute inset-0 rounded-full" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 36 }} />}
                      <span className="relative inline-flex min-w-0 items-center gap-1.5"><Icon size={15} className="shrink-0" aria-hidden /><span className="truncate sm:hidden">{short}</span><span className="hidden truncate sm:inline">{label}</span>{n >= 0 && <span className="hidden opacity-75 min-[420px]:inline">({n})</span>}</span>
                    </button>
                  ))}
                </div>

                {tab !== "local" && (
                  <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-4">
                    {options.length === 0 ? (
                      <p className="glass-inner p-4 text-[13.5px] text-muted">{tab === "video" ? "This source has no video stream, so there are no video outputs." : "This source has no audio stream, so there are no audio outputs."}</p>
                    ) : (
                      <OptionList options={options} selected={selected} onSelect={setSelected} />
                    )}
                    {tab === "audio" && options.length > 0 && <p className="mt-3 flex items-start gap-2 text-[12.5px] text-muted"><Info size={14} className="mt-0.5 shrink-0" aria-hidden /> MP3 uses LAME variable bitrate (VBR); the kbps figures are typical averages, not a constant bitrate. Conversion can&apos;t restore quality the source doesn&apos;t have.</p>}
                  </div>
                )}
                {tab === "local" && <LocalDrop processing={processing} maxBytes={status.limits?.max_upload_bytes ?? null} onFile={(f) => void onFile(f)} />}

                {tab !== "local" && selectedOption && (
                  <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div>
                      <label htmlFor="fname" className="mb-1.5 block text-[12.5px] font-medium text-muted">File name</label>
                      <div className="flex items-center rounded-full border border-line-strong bg-surface-inner pe-4 focus-within:border-accent-strong focus-within:ring-4 focus-within:ring-[color-mix(in_srgb,var(--accent-strong)_18%,transparent)]">
                        <input id="fname" value={filename} maxLength={150} onChange={(e) => setFilename(e.target.value)} placeholder="JustDownload media" data-testid="filename-input"
                          className="h-11 min-w-0 flex-1 bg-transparent ps-4 text-[14px] text-fg placeholder:text-faint focus:outline-none" />
                        <span className="font-mono text-[12.5px] text-faint">.{selectedOption.extension}</span>
                      </div>
                    </div>
                    <Button variant="primary" size="lg" onClick={() => void start()} disabled={starting || !view.id} data-testid="start-button">
                      {starting ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <ArrowRight size={17} aria-hidden />} {selectedOption.operation === "original" ? "Download" : "Convert & download"}
                    </Button>
                  </div>
                )}
                {startError && (
                  <div role="alert" className="mt-3 rounded-2xl border border-danger/40 bg-danger/10 p-3 text-[13px] text-danger" data-testid="start-error">
                    <b>{startError.message}</b> {startError.action}
                  </div>
                )}
              </div>
            )}

            {view.notices.length > 0 && (
              <ul className="mt-5 space-y-1.5 border-t border-line pt-4 text-[12.5px] text-muted">
                {view.notices.map((n) => <li key={n} className="flex items-start gap-2"><Info size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden />{n}</li>)}
              </ul>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {phase.kind === "idle" && (
        <section aria-labelledby="local-title" className="glass rounded-[var(--radius)] p-4 sm:p-6">
          <h2 id="local-title" className="flex items-center gap-2 text-[15px] font-bold"><Upload size={16} className="text-accent" aria-hidden /> Or convert a file from your device</h2>
          <div className="mt-3"><LocalDrop processing={processing} maxBytes={status.limits?.max_upload_bytes ?? null} onFile={(f) => void onFile(f)} /></div>
        </section>
      )}
    </div>
  );
}

function Preview({ view, titleRef }: { view: InspectionView; titleRef: React.RefObject<HTMLHeadingElement | null> }) {
  // Focus the result heading once it is actually mounted (after the exit animation of the loader).
  useEffect(() => { titleRef.current?.focus(); }, [titleRef]);
  const m = view.media;
  const v = m?.video[0];
  const a = m?.audio[0];
  const title = m?.title ?? view.source.filename ?? (view.mode === "policy" ? view.provider.displayName : "Untitled media");
  const Icon = view.mode === "policy" ? ShieldAlert : v ? FileVideo : FileAudio;
  return (
    <div className="flex items-start gap-4">
      <div className={`grid h-20 w-24 shrink-0 place-items-center rounded-[18px] ring-1 ring-line sm:w-28 ${view.mode === "policy" ? "bg-warn/10 text-warn" : "bg-surface-inner text-accent"}`} aria-hidden>
        <Icon size={30} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 ref={titleRef} tabIndex={-1} id="result-title" className="truncate text-[17px] font-bold outline-none" title={title} data-testid="media-title">{title}</h2>
        <p className="mt-0.5 truncate text-[12.5px] text-muted">{view.source.kind === "upload" ? "Uploaded file" : view.source.host}{m?.artist ? ` · ${m.artist}` : ""}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone={view.download_allowed ? "accent" : "warn"}>{view.provider.displayName}</Chip>
          <Chip tone={view.download_allowed ? "accent" : "warn"}>{view.provider.downloadLabel}</Chip>
          {m && <Chip>{m.container.toUpperCase()}</Chip>}
          {m && <Chip>{formatDuration(m.duration_sec)}</Chip>}
          {m && <Chip>{formatBytes(m.size_bytes)}</Chip>}
          {v && <Chip>{v.width}×{v.height} {codecName(v.codec)}{v.fps ? ` · ${Math.round(v.fps * 100) / 100} fps` : ""}</Chip>}
          {a && <Chip>{codecName(a.codec)} audio{a.sampleRate ? ` · ${a.sampleRate / 1000} kHz` : ""}{a.channels ? ` · ${a.channels} ch` : ""}</Chip>}
          {m && !a && <Chip tone="warn">No audio track</Chip>}
        </div>
      </div>
    </div>
  );
}

function PolicyCard({ view }: { view: InspectionView }) {
  const route = view.provider.officialRoute;
  return (
    <div className="mt-5 rounded-[18px] border border-warn/35 bg-warn/8 p-4" data-testid="policy-card">
      <p className="flex items-center gap-2 text-[14px] font-bold text-warn"><ShieldAlert size={16} aria-hidden /> Not processed by JustDownload</p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{view.provider.reason}</p>
      {route && (
        <a href={route.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm", "mt-3")}>
          {route.label} <ExternalLink size={13} aria-hidden />
        </a>
      )}
    </div>
  );
}

function BasicCard({ view }: { view: InspectionView }) {
  const b = view.basic!;
  const rows: Array<[string, string]> = [
    ["Detected format", b.sniffed_label],
    ["Server content type", b.content_type ?? "not stated"],
    ["Size reported by server", formatBytes(b.content_length)],
    ["Resumable (range requests)", b.accept_ranges ? "Yes" : "No"],
    ["Served from", `${b.final_host}${b.redirects ? ` (after ${b.redirects} redirect${b.redirects > 1 ? "s" : ""})` : ""}`],
  ];
  return (
    <div className="mt-5" data-testid="basic-card">
      <dl className="glass-inner grid gap-x-6 gap-y-2.5 p-4 text-[13px] sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0"><dt className="text-[11.5px] font-medium text-faint">{k}</dt><dd className="truncate font-semibold text-fg">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-4 rounded-[18px] border border-warn/35 bg-warn/8 p-4">
        <p className="flex items-center gap-2 text-[14px] font-bold text-warn"><Info size={16} aria-hidden /> Downloading and conversion aren&apos;t available on this deployment</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">No processing worker is connected, so codecs, resolution and duration can&apos;t be read and no output options are offered. Nothing here is guessed.</p>
      </div>
    </div>
  );
}

function OptionList({ options, selected, onSelect }: { options: OutputOption[]; selected: string | null; onSelect: (id: string) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="sr-only">Choose an output</legend>
      <div className="grid gap-2.5 md:grid-cols-2" data-testid="option-list">
        {options.map((o) => {
          const active = o.id === selected;
          const badge = o.operation === "original" ? { t: "Original", tone: "ok" as const } : !o.lossy ? { t: "Lossless", tone: "ok" as const } : { t: "Re-encode", tone: "neutral" as const };
          return (
            <label key={o.id} className={`jd-transition relative flex cursor-pointer gap-3 rounded-[18px] border p-3.5 ${active ? "border-accent-strong bg-accent/10 ring-2 ring-[color-mix(in_srgb,var(--accent-strong)_30%,transparent)]" : "border-line bg-surface-inner hover:border-line-strong hover:bg-surface-hover"}`} data-testid={`option-${o.id}`}>
              <input type="radio" name={name} value={o.id} checked={active} onChange={() => onSelect(o.id)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent-strong)]" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13.5px] font-bold">{o.label}</span>
                  <Chip tone={badge.tone}>{badge.t}</Chip>
                </span>
                <span className="mt-1 block text-[12px] text-muted">{o.details.join(" · ")}</span>
                <span className="mt-1 block text-[11.5px] text-faint">{o.exactSizeBytes != null ? `Exactly ${formatBytes(o.exactSizeBytes)} · ` : "Final size depends on the content · "}{o.note}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function LocalDrop({ processing, maxBytes, onFile }: { processing: boolean; maxBytes: number | null; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!processing) {
    return (
      <div className="glass-inner flex items-start gap-3 border-dashed p-4 text-[13px] text-muted" data-testid="local-unavailable">
        <Info size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <span>Converting files from your device needs a processing worker (FFmpeg), and none is connected to this deployment. Files are never processed in your browser or faked.</span>
      </div>
    );
  }
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={`jd-transition flex flex-col items-center gap-2 rounded-[18px] border-2 border-dashed p-6 text-center ${over ? "border-accent-strong bg-accent/10" : "border-line-strong bg-surface-inner"}`}>
      <IconChip tone="accent" size={44}><Upload size={19} /></IconChip>
      <p className="text-[14px] font-semibold">Drop an audio or video file here</p>
      <p className="text-[12.5px] text-muted">Converted on the processing worker and deleted after the retention period{maxBytes ? ` · up to ${formatBytes(maxBytes)}` : ""}.</p>
      <input ref={input} type="file" accept="audio/*,video/*" className="sr-only" id="local-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <label htmlFor="local-file" className={buttonClass("secondary", "sm", "mt-1 cursor-pointer")}>Choose a file</label>
    </div>
  );
}
