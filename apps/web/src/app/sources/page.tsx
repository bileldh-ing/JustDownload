import type { Metadata } from "next";
import { CheckCircle2, ExternalLink, MinusCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Chip } from "@/components/ui";
import { appStatus } from "@/server/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Supported sources" };

const METHOD: Record<string, string> = {
  direct_probe: "FFprobe on the fetched file", upload_probe: "FFprobe on your upload", approved_extractor: "Approved extractor", official_api: "Official API", none: "None (not inspected)",
};

function Yes({ on }: { on: boolean }) {
  return on ? <span className="inline-flex items-center gap-1 text-ok"><CheckCircle2 size={14} aria-hidden /> Yes</span> : <span className="inline-flex items-center gap-1 text-faint"><MinusCircle size={14} aria-hidden /> No</span>;
}

export default async function SourcesPage() {
  const status = await appStatus();
  return (
    <AppShell status={status}>
      <section className="glass rounded-[var(--radius)] p-5 sm:p-7">
        <h1 className="text-[24px] font-bold tracking-tight">Supported sources</h1>
        <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-muted">
          This table is generated from the server-side provider policy registry that the API enforces. The browser can&apos;t change it. &ldquo;Reviewed&rdquo; is the date the policy entry was last checked against the linked terms by the maintainers; it is not legal advice.
        </p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-[13px]">
            <caption className="sr-only">Provider capabilities</caption>
            <thead>
              <tr className="text-[11.5px] uppercase tracking-[0.1em] text-faint">
                <th scope="col" className="border-b border-line pb-2 pe-4 font-bold">Source</th>
                <th scope="col" className="border-b border-line pb-2 pe-4 font-bold">Download</th>
                <th scope="col" className="border-b border-line pb-2 pe-4 font-bold">Metadata</th>
                <th scope="col" className="border-b border-line pb-2 pe-4 font-bold">Video</th>
                <th scope="col" className="border-b border-line pb-2 pe-4 font-bold">Audio / MP3</th>
                <th scope="col" className="border-b border-line pb-2 pe-4 font-bold">Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {status.providers.map((p) => {
                const on = p.download === "enabled" || p.download === "authorized_download";
                return (
                  <tr key={p.id} className="align-top" data-testid={`provider-${p.id}`}>
                    <th scope="row" className="border-b border-line py-3 pe-4 font-semibold">
                      {p.displayName}
                      {p.hosts.length > 0 && <div className="mt-0.5 font-mono text-[11px] font-normal text-faint">{p.hosts.join(", ")}{p.pathPrefixes ? ` (${p.pathPrefixes.join(", ")})` : ""}</div>}
                      <p className="mt-1.5 max-w-sm text-[12px] font-normal leading-relaxed text-muted">{p.reason}</p>
                      {p.officialRoute && <a href={p.officialRoute.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">{p.officialRoute.label} <ExternalLink size={11} aria-hidden /></a>}
                    </th>
                    <td className="border-b border-line py-3 pe-4"><Chip tone={on ? "ok" : p.download === "disabled" ? "danger" : "warn"}>{p.downloadLabel}</Chip>{p.status !== "operational" && <div className="mt-1"><Chip tone="danger">{p.status}</Chip></div>}</td>
                    <td className="border-b border-line py-3 pe-4 text-muted">{METHOD[p.metadataMethod] ?? p.metadataMethod}</td>
                    <td className="border-b border-line py-3 pe-4"><Yes on={on && p.features.video} /></td>
                    <td className="border-b border-line py-3 pe-4"><Yes on={on && p.features.audioExtraction} /></td>
                    <td className="border-b border-line py-3 pe-4 font-mono text-[12px] text-muted"><a href={p.docsUrl} target="_blank" rel="noopener noreferrer" className="hover:text-fg hover:underline">{p.lastReviewed}</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[12.5px] text-muted">Not supported in this version: playlists, captions, thumbnails, and streaming playlists (HLS/DASH). Unknown websites are treated as direct-media links: if the link is a web page rather than a file, inspection says so instead of crawling it.</p>
      </section>
    </AppShell>
  );
}
