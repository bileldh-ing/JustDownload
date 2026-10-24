import type { BasicProbe, InspectionView } from "../api";
import { JdError } from "../errors";
import { allowsDownload, resolveProvider, toPublicProvider, type ProviderPolicy } from "../providers";
import { sniffContainer } from "../sniff";
import { normalizeUrl, type NormalizedUrl, type UrlPolicyOptions } from "../url-safety";
import { readPrefix, safeFetch, totalSizeFromHeaders, type SafeFetchOptions } from "./safe-fetch";

const PREFIX_BYTES = 64 * 1024;

/** Inspection result for providers that don't allow downloads: no network request is made at all. */
export function policyOnlyView(provider: ProviderPolicy, url: NormalizedUrl): InspectionView {
  return {
    id: null, mode: "policy",
    source: { kind: "url", host: url.hostname, redacted: url.redacted, filename: null },
    provider: toPublicProvider(provider), download_allowed: false, media: null, basic: null, options: [],
    notices: [provider.reason],
    inspected_at: new Date().toISOString(), expires_at: null,
  };
}

/**
 * Lightweight probe: fetch at most the first 64 KB with a Range request through the SSRF-safe
 * client, then report what the server actually returned. It cannot see codecs, resolution or
 * duration (that needs FFprobe on the worker) and it says so instead of guessing.
 */
export async function basicProbe(url: NormalizedUrl, opts: SafeFetchOptions & { maxRedirects?: number }): Promise<BasicProbe> {
  const res = await safeFetch(url.href, { ...opts, headers: { range: `bytes=0-${PREFIX_BYTES - 1}` } });
  if (res.status !== 200 && res.status !== 206) {
    res.body.resume();
    res.body.destroy();
    throw new JdError("SOURCE_HTTP_ERROR", { internal: `status ${res.status}` });
  }
  const prefix = await readPrefix(res.body, PREFIX_BYTES);
  const sniff = sniffContainer(prefix);
  const contentType = res.headers["content-type"] ? String(res.headers["content-type"]).split(";")[0]!.trim().toLowerCase() : null;
  if (sniff.kind === "manifest") throw new JdError("STREAMING_MANIFEST_UNSUPPORTED");
  if (sniff.kind === "document") throw new JdError("SOURCE_NOT_MEDIA", { internal: sniff.label });
  if (sniff.kind === "unknown" && !(contentType?.startsWith("audio/") || contentType?.startsWith("video/"))) throw new JdError("SOURCE_NOT_MEDIA", { internal: `unknown bytes, ${contentType}` });
  return {
    content_type: contentType,
    content_length: totalSizeFromHeaders(res.status, res.headers),
    accept_ranges: res.status === 206 || String(res.headers["accept-ranges"] ?? "").toLowerCase() === "bytes",
    sniffed_label: sniff.label,
    sniffed_container: sniff.container,
    kind: sniff.kind,
    final_host: res.finalUrl.hostname,
    redirects: res.redirects,
  };
}

/** Basic inspection used by the web app when no processing worker is configured. */
export async function basicInspect(input: string, registry: readonly ProviderPolicy[], opts: UrlPolicyOptions & { timeoutMs?: number } = {}): Promise<InspectionView> {
  const url = normalizeUrl(input, opts);
  const provider = resolveProvider(url, registry);
  if (!allowsDownload(provider)) return policyOnlyView(provider, url);
  const basic = await basicProbe(url, { ...opts, maxRedirects: provider.limits.maxRedirects });
  const finalProvider = resolveProvider(basic.final_host, registry);
  if (!allowsDownload(finalProvider)) return policyOnlyView(finalProvider, url);
  return {
    id: null, mode: "basic",
    source: { kind: "url", host: url.hostname, redacted: url.redacted, filename: null },
    provider: toPublicProvider(provider), download_allowed: true, media: null, basic, options: [],
    notices: [
      "Basic inspection only: the first 64 KB of the file were checked to confirm what the server returns.",
      "Codecs, resolution and duration need FFprobe on a processing worker, and no worker is connected to this deployment, so no download or conversion options are offered here.",
    ],
    inspected_at: new Date().toISOString(), expires_at: null,
  };
}
