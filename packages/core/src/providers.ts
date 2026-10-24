import { JdError } from "./errors";

/**
 * Server-side provider policy registry.
 *
 * This is the single source of truth for what JustDownload will do with a link. The client never
 * sends a capability; it sends a URL, and the server looks the provider up here. A provider can only
 * be switched to `enabled` by the operator through server configuration (JD_PROVIDER_POLICY_OVERRIDES),
 * and only after its intended use has been confirmed as permitted (see docs/PROVIDER_POLICY.md).
 *
 * `lastReviewed` is the date this entry's policy was written or re-checked against the linked
 * documentation by the project maintainers. It is NOT a legal opinion.
 */

export const DOWNLOAD_CAPABILITIES = ["disabled", "metadata_only", "official_export_only", "authorized_download", "enabled"] as const;
export type DownloadCapability = (typeof DOWNLOAD_CAPABILITIES)[number];

export type MetadataMethod = "direct_probe" | "upload_probe" | "approved_extractor" | "official_api" | "none";
export type OperationalStatus = "operational" | "degraded" | "outage";

export interface ProviderFeatures {
  video: boolean;
  audioExtraction: boolean;
  playlists: boolean;
  captions: boolean;
  thumbnails: boolean;
  formatProbing: boolean;
}

export interface ProviderPolicy {
  id: string;
  displayName: string;
  /** Hostnames (exact or suffix match on a dot boundary). Empty for non-URL providers. */
  hosts: readonly string[];
  /** If set, the provider only claims URLs whose path starts with one of these prefixes. */
  pathPrefixes?: readonly string[];
  metadataMethod: MetadataMethod;
  download: DownloadCapability;
  /** Shown to users and support staff. */
  reason: string;
  /** What the user can do instead (official export path), if downloading is not offered. */
  officialRoute?: { label: string; url: string };
  docsUrl: string;
  lastReviewed: string;
  features: ProviderFeatures;
  limits: { timeoutSeconds: number; maxConcurrentJobs: number; maxRetries: number; maxRedirects: number };
  status: OperationalStatus;
}

const NONE: ProviderFeatures = { video: false, audioExtraction: false, playlists: false, captions: false, thumbnails: false, formatProbing: false };
const DEFAULT_LIMITS = { timeoutSeconds: 30, maxConcurrentJobs: 4, maxRetries: 2, maxRedirects: 5 };
const REVIEWED = "2026-10-24";

const PLATFORM_REASON = "This platform's terms restrict downloading and automated extraction. JustDownload does not extract media from it. Use the platform's own download or export feature for content you own.";

export const BASE_PROVIDER_REGISTRY: readonly ProviderPolicy[] = [
  {
    id: "direct_media",
    displayName: "Direct media file link",
    hosts: [],
    metadataMethod: "direct_probe",
    download: "enabled",
    reason: "A public link that points straight at an audio or video file (for example https://example.com/clip.mp4). The file is fetched with strict network safety checks and analysed with FFprobe before any options are shown.",
    docsUrl: "https://ffmpeg.org/ffprobe.html",
    lastReviewed: REVIEWED,
    features: { video: true, audioExtraction: true, playlists: false, captions: false, thumbnails: false, formatProbing: true },
    limits: { timeoutSeconds: 60, maxConcurrentJobs: 4, maxRetries: 2, maxRedirects: 5 },
    status: "operational",
  },
  {
    id: "upload",
    displayName: "Your own file (upload)",
    hosts: [],
    metadataMethod: "upload_probe",
    download: "enabled",
    reason: "Convert a file from your device. It is analysed with FFprobe, converted on the processing worker and deleted after the retention period.",
    docsUrl: "https://ffmpeg.org/ffmpeg.html",
    lastReviewed: REVIEWED,
    features: { video: true, audioExtraction: true, playlists: false, captions: false, thumbnails: false, formatProbing: true },
    limits: { timeoutSeconds: 120, maxConcurrentJobs: 4, maxRetries: 1, maxRedirects: 0 },
    status: "operational",
  },
  {
    id: "youtube",
    displayName: "YouTube",
    hosts: ["youtube.com", "youtu.be", "youtube-nocookie.com", "music.youtube.com"],
    metadataMethod: "none",
    download: "official_export_only",
    reason: PLATFORM_REASON,
    officialRoute: { label: "Download your own uploads from YouTube Studio", url: "https://support.google.com/youtube/answer/56100" },
    docsUrl: "https://www.youtube.com/t/terms",
    lastReviewed: REVIEWED,
    features: NONE,
    limits: DEFAULT_LIMITS,
    status: "operational",
  },
  {
    id: "facebook",
    displayName: "Facebook",
    hosts: ["facebook.com", "fb.watch", "fb.com"],
    metadataMethod: "none",
    download: "official_export_only",
    reason: PLATFORM_REASON,
    officialRoute: { label: "Download your information from Facebook", url: "https://www.facebook.com/help/212802592074644" },
    docsUrl: "https://www.facebook.com/legal/automated_data_collection_terms",
    lastReviewed: REVIEWED,
    features: NONE,
    limits: DEFAULT_LIMITS,
    status: "operational",
  },
  {
    id: "instagram",
    displayName: "Instagram",
    hosts: ["instagram.com", "instagr.am"],
    metadataMethod: "none",
    download: "official_export_only",
    reason: PLATFORM_REASON,
    officialRoute: { label: "Download a copy of your Instagram data", url: "https://help.instagram.com/181231772500920" },
    docsUrl: "https://www.instagram.com/legal/terms/",
    lastReviewed: REVIEWED,
    features: NONE,
    limits: DEFAULT_LIMITS,
    status: "operational",
  },
  {
    id: "tiktok",
    displayName: "TikTok",
    hosts: ["tiktok.com", "vm.tiktok.com"],
    metadataMethod: "none",
    download: "official_export_only",
    reason: PLATFORM_REASON,
    officialRoute: { label: "About TikTok post downloads (creators decide whether downloads are allowed)", url: "https://support.tiktok.com/en/account-and-privacy/account-privacy-settings/video-downloads" },
    docsUrl: "https://www.tiktok.com/legal/page/row/terms-of-service/en",
    lastReviewed: REVIEWED,
    features: NONE,
    limits: DEFAULT_LIMITS,
    status: "operational",
  },
  {
    id: "x",
    displayName: "X (Twitter)",
    hosts: ["x.com", "twitter.com", "t.co"],
    metadataMethod: "none",
    download: "disabled",
    reason: "X's terms prohibit scraping and automated access without permission. JustDownload does not process X links.",
    officialRoute: { label: "Download an archive of your X data", url: "https://help.x.com/en/managing-your-account/how-to-download-your-x-archive" },
    docsUrl: "https://x.com/tos",
    lastReviewed: REVIEWED,
    features: NONE,
    limits: DEFAULT_LIMITS,
    status: "operational",
  },
  {
    id: "vimeo",
    displayName: "Vimeo",
    hosts: ["vimeo.com", "player.vimeo.com"],
    metadataMethod: "none",
    download: "official_export_only",
    reason: "Vimeo lets video owners decide whether a Download button is offered. JustDownload does not extract media from Vimeo pages.",
    officialRoute: { label: "Use Vimeo's Download button when the owner has enabled it", url: "https://help.vimeo.com/hc/en-us/articles/12426502581265-How-to-download-a-video-on-Vimeo" },
    docsUrl: "https://vimeo.com/terms",
    lastReviewed: REVIEWED,
    features: NONE,
    limits: DEFAULT_LIMITS,
    status: "operational",
  },
  {
    id: "soundcloud",
    displayName: "SoundCloud",
    hosts: ["soundcloud.com", "on.soundcloud.com"],
    metadataMethod: "none",
    download: "official_export_only",
    reason: "SoundCloud lets creators enable downloads on their tracks. JustDownload does not extract audio from SoundCloud pages.",
    officialRoute: { label: "SoundCloud downloads are enabled per track by the creator", url: "https://help.soundcloud.com/hc/en-us/articles/31423603670043-Enabling-Downloads-For-Your-Track" },
    docsUrl: "https://soundcloud.com/terms-of-use",
    lastReviewed: REVIEWED,
    features: NONE,
    limits: DEFAULT_LIMITS,
    status: "operational",
  },
  {
    id: "internet_archive_page",
    displayName: "Internet Archive item page",
    hosts: ["archive.org"],
    pathPrefixes: ["/details/", "/embed/"],
    metadataMethod: "none",
    download: "official_export_only",
    reason: "Item pages are web pages, not media files. The Internet Archive publishes direct download links for each file, and those links work here as direct media links.",
    officialRoute: { label: "Open the item's \u201cDownload options\u201d and copy a direct file link", url: "https://help.archive.org/help/downloading-a-basic-guide/" },
    docsUrl: "https://archive.org/developers/items.html",
    lastReviewed: REVIEWED,
    features: NONE,
    limits: DEFAULT_LIMITS,
    status: "operational",
  },
];

export type PolicyOverride = Partial<Pick<ProviderPolicy, "download" | "status" | "reason" | "metadataMethod">> & { features?: Partial<ProviderFeatures> };

/**
 * Build the effective registry. Overrides come ONLY from server configuration (never a request).
 * An override can't create new providers, and turning a platform to `enabled` requires
 * `metadataMethod: "approved_extractor"` so the decision is explicit in config review.
 */
export function buildRegistry(overrides: Record<string, PolicyOverride> = {}): ProviderPolicy[] {
  return BASE_PROVIDER_REGISTRY.map((p) => {
    const o = overrides[p.id];
    if (!o) return { ...p, features: { ...p.features } };
    if (o.download && !DOWNLOAD_CAPABILITIES.includes(o.download)) throw new Error(`invalid download capability for ${p.id}`);
    const merged: ProviderPolicy = { ...p, ...o, features: { ...p.features, ...(o.features ?? {}) } };
    if ((merged.download === "enabled" || merged.download === "authorized_download") && p.hosts.length > 0 && merged.metadataMethod !== "approved_extractor") {
      throw new Error(`provider ${p.id}: enabling downloads for a platform requires metadataMethod "approved_extractor" in the override`);
    }
    return merged;
  });
}

export function parsePolicyOverrides(json: string | undefined): Record<string, PolicyOverride> {
  if (!json || !json.trim()) return {};
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JD_PROVIDER_POLICY_OVERRIDES must be a JSON object");
  return parsed as Record<string, PolicyOverride>;
}

function hostMatches(hostname: string, pattern: string): boolean {
  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

/** Same matching rule over the public projection (used client-side for instant feedback; the server decides). */
export function matchPublicProvider(hostname: string, pathname: string, providers: readonly PublicProvider[]): PublicProvider | null {
  const h = hostname.toLowerCase();
  for (const p of providers) {
    if (!p.hosts.some((pattern) => hostMatches(h, pattern))) continue;
    if (p.pathPrefixes && !p.pathPrefixes.some((pre) => pathname.startsWith(pre))) continue;
    return p;
  }
  return providers.find((p) => p.id === "direct_media") ?? null;
}

/** Find the provider for a normalized URL. Unknown hosts fall back to the direct-media provider. */
export function resolveProvider(target: string | { hostname: string; pathname?: string }, registry: readonly ProviderPolicy[]): ProviderPolicy {
  const h = (typeof target === "string" ? target : target.hostname).toLowerCase();
  const path = typeof target === "string" ? "/" : target.pathname ?? "/";
  for (const p of registry) {
    if (!p.hosts.some((pattern) => hostMatches(h, pattern))) continue;
    if (p.pathPrefixes && !p.pathPrefixes.some((pre) => path.startsWith(pre))) continue;
    return p;
  }
  return registry.find((p) => p.id === "direct_media")!;
}

/** True if this provider may produce files through JustDownload. */
export function allowsDownload(p: ProviderPolicy): boolean {
  return (p.download === "enabled" || p.download === "authorized_download") && p.status !== "outage";
}

/** Throws if downloads are not permitted. Used at inspection time and again at job creation. */
export function assertDownloadAllowed(p: ProviderPolicy): void {
  if (p.status === "outage") throw new JdError("PROVIDER_UNAVAILABLE");
  if (!allowsDownload(p)) throw new JdError("PROVIDER_DOWNLOAD_UNAVAILABLE");
}

export const CAPABILITY_LABEL: Record<DownloadCapability, string> = {
  disabled: "Not supported",
  metadata_only: "Metadata only",
  official_export_only: "Official export only",
  authorized_download: "Authorized download",
  enabled: "Download & convert",
};

/** Public projection: what the UI may see. No operational internals. */
export interface PublicProvider {
  id: string;
  displayName: string;
  hosts: readonly string[];
  pathPrefixes: readonly string[] | null;
  download: DownloadCapability;
  downloadLabel: string;
  metadataMethod: MetadataMethod;
  reason: string;
  officialRoute?: { label: string; url: string };
  docsUrl: string;
  lastReviewed: string;
  features: ProviderFeatures;
  status: OperationalStatus;
}

export function toPublicProvider(p: ProviderPolicy): PublicProvider {
  return {
    id: p.id, displayName: p.displayName, hosts: p.hosts, pathPrefixes: p.pathPrefixes ?? null, download: p.download, downloadLabel: CAPABILITY_LABEL[p.download],
    metadataMethod: p.metadataMethod, reason: p.reason, officialRoute: p.officialRoute, docsUrl: p.docsUrl,
    lastReviewed: p.lastReviewed, features: p.features, status: p.status,
  };
}
