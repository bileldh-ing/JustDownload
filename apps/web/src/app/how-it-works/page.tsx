import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { FAQ } from "@/components/HomeBelowFold";
import { appStatus } from "@/server/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "How it works" };

export default async function HowPage() {
  const status = await appStatus();
  return (
    <AppShell status={status}>
      <article className="glass prose-jd rounded-[var(--radius)] p-5 sm:p-8">
        <h1 className="text-[24px] font-bold tracking-tight">How JustDownload works</h1>
        <p>JustDownload has two parts: this web app, and a separate processing worker that runs FFprobe and FFmpeg. Heavy media work never runs inside the web server.</p>
        <h2>1. Inspection</h2>
        <ul>
          <li>The link is normalised and checked: only <code>http</code>/<code>https</code>, no embedded passwords, no private, local or cloud-metadata addresses. DNS answers and every redirect are re-checked.</li>
          <li>The provider policy decides what is allowed. Restricted platforms are answered with their policy and official export route, without any request to the platform.</li>
          <li>For direct files, the worker fetches the start of the file and runs FFprobe. If the start isn&apos;t enough (for example an MP4 whose index sits at the end) and the file is small, it fetches the whole file once and reuses it for the job.</li>
          <li>Without a worker, the web app can only fetch the first 64 KB and report what the server returns (format, size, range support). It says so and offers no download options.</li>
        </ul>
        <h2>2. Formats: extraction vs conversion</h2>
        <ul>
          <li><b>Original file</b>: exactly the bytes the source serves.</li>
          <li><b>Remux</b>: the same audio and video streams copied into a different container (for example MKV to MP4). Fast and lossless; offered only when the codecs fit.</li>
          <li><b>Re-encode</b>: H.264/AAC MP4 at the source resolution or lower. Slower and slightly lossy. Never upscaled.</li>
          <li><b>Audio</b>: MP3 (LAME VBR V0/V2/V5), M4A (original AAC copied when possible, otherwise AAC 192 kbps), Opus, or WAV, depending on what the worker&apos;s FFmpeg build supports.</li>
        </ul>
        <h2>3. Processing</h2>
        <p>Jobs move through explicit states: queued, downloading, converting, verifying, ready (or failed / cancelled / expired). Progress percentages appear only when they can be measured: download bytes against a known size, or FFmpeg&apos;s own progress against a known duration. Otherwise the bar is shown as in progress without a number.</p>
        <p>A job is ready only after FFprobe has verified the output (container, codecs, resolution and duration) and its SHA-256 checksum has been recorded. Downloads use private links that expire after 10 minutes.</p>
        <h2 id="faq">FAQ</h2>
        {FAQ.map((f) => (
          <div key={f.q}>
            <h3>{f.q}</h3>
            <p>{f.a}</p>
          </div>
        ))}
      </article>
    </AppShell>
  );
}
