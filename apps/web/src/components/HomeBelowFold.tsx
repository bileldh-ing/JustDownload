import Link from "next/link";
import { ArrowRight, FileCheck2, ScanSearch, SlidersHorizontal } from "lucide-react";
import type { AppStatus } from "@/server/status";
import { Chip, IconChip, SectionLabel } from "./ui";

const STEPS = [
  { icon: ScanSearch, title: "Inspect", text: "The link is checked against the source policy and network safety rules, then the file itself is analysed with FFprobe." },
  { icon: SlidersHorizontal, title: "Choose", text: "Pick from formats that actually exist in the source, or a clearly labelled conversion. Nothing above the source resolution is offered." },
  { icon: FileCheck2, title: "Verify & download", text: "FFmpeg produces the file, FFprobe verifies it, and only then is it marked ready behind a short-lived private link." },
];

export const FAQ: Array<{ q: string; a: string }> = [
  { q: "Which links work?", a: "Public links that point directly at an audio or video file (for example a .mp4 or .mp3 on a server you control, or a direct file link from the Internet Archive). Web pages of video platforms are not media files and are handled by their provider policy." },
  { q: "Why can't I download from YouTube, Facebook, Instagram or TikTok?", a: "Their terms restrict downloading and automated extraction. JustDownload doesn't scrape them or work around their restrictions. Where the platform offers an official export for your own content, the app links to it." },
  { q: "Is the 1080p option really 1080p?", a: "Options come from the probed source. A 720p source never shows 1080p or 4K, and re-encoded outputs are labelled as re-encodes. Exact sizes are shown only for the original file; other sizes depend on the content." },
  { q: "Will converting to MP3 improve the sound?", a: "No. Conversion can't restore detail the source doesn't contain. MP3 uses LAME VBR presets (V0, V2, V5); their kbps figures are typical averages." },
  { q: "How long are files kept?", a: "Finished files are deleted automatically after the deployment's retention period (shown on the page), and you can delete a job immediately from its page." },
  { q: "Why does a job fail?", a: "Common reasons: the source went offline, the file is larger or longer than this deployment allows, the link is a web page or streaming playlist rather than a file, or the file is damaged. Each failure shows a specific reason and what to do next." },
];

export function HomeBelowFold({ status }: { status: AppStatus }) {
  const enabled = status.providers.filter((p) => p.download === "enabled");
  const restricted = status.providers.filter((p) => p.download !== "enabled");
  return (
    <div className="mt-8 space-y-5">
      <section aria-labelledby="how-title" className="glass rounded-[var(--radius)] p-5 sm:p-6">
        <SectionLabel id="how-title">How it works</SectionLabel>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="glass-inner p-4">
              <div className="flex items-center gap-3"><IconChip tone={i === 0 ? "accent" : "neutral"} size={38}><Icon size={17} /></IconChip><h3 className="text-[14.5px] font-bold">{i + 1}. {title}</h3></div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="cap-title" className="glass rounded-[var(--radius)] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel id="cap-title">Supported sources</SectionLabel>
          <Link href="/sources" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">Full capability table <ArrowRight size={14} aria-hidden /></Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {enabled.map((p) => <Chip key={p.id} tone="ok">{p.displayName} · {p.downloadLabel}</Chip>)}
          {restricted.map((p) => <Chip key={p.id} tone="warn">{p.displayName} · {p.downloadLabel}</Chip>)}
        </div>
        <p className="mt-3 text-[12.5px] text-muted">There is no &ldquo;every site&rdquo; promise: capabilities are set by a server-side policy and shown here exactly as configured.</p>
      </section>

      <section aria-labelledby="faq-title" className="glass rounded-[var(--radius)] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel id="faq-title">FAQ</SectionLabel>
          <Link href="/how-it-works#faq" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">All answers <ArrowRight size={14} aria-hidden /></Link>
        </div>
        <div className="mt-3 divide-y divide-[var(--border)]">
          {FAQ.slice(0, 4).map((f) => (
            <details key={f.q} className="group py-3">
              <summary className="cursor-pointer list-none text-[14px] font-semibold marker:hidden">{f.q}</summary>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="px-2 text-[12px] leading-relaxed text-faint">
        Privacy: links you inspect are kept only for the inspection and job lifetime and are never written to logs in full. <Link href="/privacy" className="underline underline-offset-2">Privacy & acceptable use</Link>.
      </p>
    </div>
  );
}
