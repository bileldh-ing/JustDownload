"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CircleCheck, CircleAlert, CircleOff, Download, Layers, Plus, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import type { AppStatus } from "@/server/status";
import { LogoMark, Wordmark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Chip, buttonClass } from "./ui";

const NAV = [
  { href: "/", label: "Downloader", icon: Download, match: (p: string) => p === "/" || p.startsWith("/jobs") },
  { href: "/sources", label: "Supported sources", icon: Layers, match: (p: string) => p.startsWith("/sources") },
  { href: "/how-it-works", label: "How it works", icon: BookOpen, match: (p: string) => p.startsWith("/how-it-works") },
  { href: "/privacy", label: "Privacy & use", icon: ShieldCheck, match: (p: string) => p.startsWith("/privacy") },
];

export function workerChip(status: AppStatus) {
  switch (status.worker) {
    case "online": return { tone: "ok" as const, icon: CircleCheck, label: "Worker online", short: "Online" };
    case "degraded": return { tone: "warn" as const, icon: CircleAlert, label: "Worker at capacity", short: "Busy" };
    case "unreachable": return { tone: "danger" as const, icon: CircleAlert, label: "Worker unreachable", short: "Offline" };
    default: return { tone: "warn" as const, icon: CircleOff, label: "Inspection only", short: "Inspect only" };
  }
}

function TopBar({ status }: { status: AppStatus }) {
  const path = usePathname() ?? "/";
  const chip = workerChip(status);
  const ChipIcon = chip.icon;
  return (
    <header className="glass sticky top-3 z-40 mx-3 mt-3 flex h-14 items-center gap-2 rounded-full ps-2 pe-2 sm:mx-4 sm:gap-3 sm:pe-2.5">
      <Link href="/" className="flex items-center gap-2.5 rounded-full pe-1.5" aria-label="JustDownload home">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-inner ring-1 ring-line"><LogoMark size={28} /></span>
        <span className="hidden min-[360px]:inline"><Wordmark /></span>
      </Link>
      <span className="hidden sm:block">
        <Chip tone={chip.tone} title={status.worker === "not_configured" ? "No processing worker is connected; links can be inspected but not downloaded or converted." : undefined}>
          <ChipIcon size={12} aria-hidden /> <span data-testid="worker-chip">{chip.label}</span>
        </Chip>
      </span>
      <span aria-hidden className="mx-1 hidden h-6 w-px bg-line lg:block" />
      <nav aria-label="Main" className="hidden items-center gap-0.5 rounded-full border border-line bg-surface-inner p-1 lg:flex">
        {NAV.map((n) => {
          const active = n.match(path);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
              className={`jd-transition rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${active ? "bg-surface-hover text-fg ring-1 ring-line-strong" : "text-muted hover:text-fg"}`}>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="ms-auto flex items-center gap-1.5">
        <span className="sm:hidden" aria-hidden><Chip tone={chip.tone}><ChipIcon size={12} />{chip.short}</Chip></span>
        <ThemeToggle />
        <span className="hidden sm:block"><Link href="/#inspect" className={buttonClass("primary", "md", "h-10")}><Plus size={16} aria-hidden /> New download</Link></span>
      </div>
    </header>
  );
}

function Rail() {
  const path = usePathname() ?? "/";
  const reduce = useReducedMotion();
  return (
    <nav aria-label="Sections" className="glass fixed start-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-2 rounded-full p-2 xl:flex">
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const active = match(path);
        return (
          <Link key={href} href={href} aria-label={label} title={label} aria-current={active ? "page" : undefined}
            className={`jd-press relative grid h-11 w-11 place-items-center rounded-full ${active ? "text-accent-ink" : "text-muted hover:bg-surface-hover hover:text-fg"}`}>
            {active && <motion.span layoutId="rail-dot" className="jd-accent-fill jd-accent-glow absolute inset-0 rounded-full" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34 }} />}
            <Icon size={18} className="relative" aria-hidden />
          </Link>
        );
      })}
    </nav>
  );
}

function MobileNav() {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="Sections" className="glass fixed inset-x-3 bottom-3 z-40 flex gap-1 rounded-full p-1 lg:hidden">
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const active = match(path);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`jd-press flex h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-semibold ${active ? "jd-accent-fill jd-accent-glow" : "text-muted"}`}>
            <Icon size={17} aria-hidden />
            <span className="max-w-full truncate px-1">{label.split(" ")[0]}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function StatusBar({ status }: { status: AppStatus }) {
  const dot = status.worker === "online" ? "bg-ok" : status.worker === "unreachable" ? "bg-danger" : "bg-warn";
  const text = status.worker === "online" || status.worker === "degraded"
    ? `worker ${status.worker} · ffmpeg ${status.tools?.ffmpeg ?? "?"} · queue ${status.queue?.waiting ?? "?"} waiting / ${status.queue?.active ?? "?"} active`
    : status.worker === "unreachable" ? "worker configured but not responding · processing paused" : "no worker connected · basic link inspection only";
  return (
    <footer className="glass mx-3 mb-20 mt-6 flex h-9 items-center gap-3 overflow-x-auto whitespace-nowrap rounded-full px-4 text-[11.5px] font-medium text-muted sm:mx-4 lg:mb-3" data-testid="status-bar">
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} /><span className="font-mono">{text}</span></span>
      <span className="ms-auto hidden sm:inline">{status.limits ? `Files kept ${status.limits.retention_minutes} min` : "Nothing is stored without a worker"}</span>
      <span className="hidden font-mono text-faint md:inline">{status.region ? `region ${status.region}` : "self-hosted"}</span>
    </footer>
  );
}

export function AppShell({ status, children, aside }: { status: AppStatus; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar status={status} />
      <Rail />
      <div className="mx-auto flex w-full max-w-[1320px] flex-1 gap-5 px-3 pt-6 sm:px-4 xl:ps-24">
        <main id="main" className="min-w-0 flex-1">{children}</main>
        {aside && <aside aria-label="Overview" className="hidden w-[300px] shrink-0 xl:block">{aside}</aside>}
      </div>
      <StatusBar status={status} />
      <MobileNav />
    </div>
  );
}
