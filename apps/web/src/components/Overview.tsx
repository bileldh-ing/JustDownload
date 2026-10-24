import { Clock, Gauge, HardDrive, Layers, Server } from "lucide-react";
import { formatBytes } from "@justdownload/core";
import type { AppStatus } from "@/server/status";
import { IconChip, SectionLabel } from "./ui";

function Row({ icon, label, value, tone = "neutral", testId }: { icon: React.ReactNode; label: string; value: string; tone?: "neutral" | "accent" | "mint" | "warn" | "danger"; testId?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3" data-testid={testId}>
      <IconChip tone={tone} size={42}>{icon}</IconChip>
      <div className="min-w-0">
        <div className="truncate text-[12px] font-medium text-muted">{label}</div>
        <div className="truncate text-[17px] font-bold tracking-tight text-fg">{value}</div>
      </div>
    </div>
  );
}

/** Right-hand overview cards (PinFlow's "sketch overview" pattern), driven by real status only. */
export function Overview({ status }: { status: AppStatus }) {
  const enabled = status.providers.filter((p) => p.download === "enabled" || p.download === "authorized_download").length;
  const restricted = status.providers.length - enabled;
  const workerValue = status.worker === "online" ? "Online" : status.worker === "degraded" ? "At capacity" : status.worker === "unreachable" ? "Unreachable" : "Not connected";
  const workerTone = status.worker === "online" ? "accent" : status.worker === "unreachable" ? "danger" : "warn";
  return (
    <div className="sticky top-24 space-y-4">
      <section className="glass rounded-[var(--radius)] p-4" aria-labelledby="ov-title">
        <SectionLabel id="ov-title">Service overview</SectionLabel>
        <div className="glass-inner mt-3 space-y-4 p-4">
          <Row icon={<Server size={18} />} label="Processing worker" value={workerValue} tone={workerTone} testId="ov-worker" />
          <Row icon={<Layers size={18} />} label={`Sources · ${restricted} restricted`} value={`${enabled} enabled`} tone="mint" />
          <Row icon={<Clock size={18} />} label="File retention" value={status.limits ? `${status.limits.retention_minutes} min` : "No files stored"} />
        </div>
      </section>
      <section className="glass rounded-[var(--radius)] p-4" aria-labelledby="lim-title">
        <SectionLabel id="lim-title">Limits on this deployment</SectionLabel>
        {status.limits ? (
          <ul className="mt-3 space-y-2.5 text-[13px] text-muted">
            <li className="flex items-center gap-2"><HardDrive size={14} aria-hidden /> Source up to <b className="text-fg">{formatBytes(status.limits.max_source_bytes)}</b></li>
            <li className="flex items-center gap-2"><Gauge size={14} aria-hidden /> Media up to <b className="text-fg">{Math.round(status.limits.max_duration_sec / 60)} min</b></li>
            <li className="flex items-center gap-2"><HardDrive size={14} aria-hidden /> Uploads up to <b className="text-fg">{formatBytes(status.limits.max_upload_bytes)}</b></li>
          </ul>
        ) : (
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            This deployment has no processing worker, so it can only check what a link serves. Downloading and conversion need a JustDownload worker (FFmpeg) connected by the operator.
          </p>
        )}
      </section>
      <section className="glass rounded-[var(--radius)] p-4">
        <SectionLabel>Use it fairly</SectionLabel>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted">Only download media you own or are allowed to download. Platforms that restrict downloading are not processed.</p>
      </section>
    </div>
  );
}
