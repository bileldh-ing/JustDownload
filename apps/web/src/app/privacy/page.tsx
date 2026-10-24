import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { appStatus } from "@/server/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Privacy & acceptable use" };

const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL ?? "https://github.com/bileldh-ing/JustDownload/issues/new?title=Misuse%20or%20copyright%20report";
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null;

export default async function PrivacyPage() {
  const status = await appStatus();
  const retention = status.limits?.retention_minutes;
  return (
    <AppShell status={status}>
      <article className="glass prose-jd rounded-[var(--radius)] p-5 sm:p-8">
        <h1 className="text-[24px] font-bold tracking-tight">Privacy &amp; acceptable use</h1>
        <h2>Acceptable use</h2>
        <ul>
          <li>Use JustDownload only for media you own, are authorized to download, or that the source explicitly makes downloadable.</li>
          <li>Don&apos;t use it to get around DRM, paywalls, private accounts, logins or other access controls. It has no option to do so and never asks for your passwords or browser cookies.</li>
          <li>A checkbox can&apos;t grant permission a platform hasn&apos;t given, so which sources work is decided by the server-side policy, not by you or the app.</li>
        </ul>
        <h2>What is stored, and for how long</h2>
        <ul>
          <li>A random, anonymous session cookie (<code>jd_sid</code>) proves that your jobs are yours. There are no accounts and no tracking.</li>
          <li>Links you inspect are kept with the inspection (about 30 minutes) and the job so the file can be fetched. Logs record only the site and path, never the full link or its query string.</li>
          <li>{retention ? `Finished files are deleted automatically after ${retention} minutes.` : "This deployment has no processing worker, so no files are stored at all."} You can delete a job and its file at any time from its page.</li>
          <li>Uploaded files are deleted with their job, or after about 30 minutes if no job is started.</li>
        </ul>
        <h2>Copyright and misuse reports</h2>
        <p>If you believe content was processed here without permission, or want to report misuse, send a report with the job time, the source site, and what the content is. Don&apos;t include personal data you wouldn&apos;t want published{CONTACT ? "" : " (reports opened on GitHub are public)"}.</p>
        <ul>
          {CONTACT && <li>Email: <a href={`mailto:${CONTACT}`}>{CONTACT}</a></li>}
          <li><a href={REPORT_URL} target="_blank" rel="noopener noreferrer">Open a report</a></li>
        </ul>
        <h2>Limits of this notice</h2>
        <p>This page describes how the software behaves. It is not legal advice, and the project has not yet had a formal legal review; operators running a public instance are responsible for their own terms, privacy obligations and local law.</p>
      </article>
    </AppShell>
  );
}
