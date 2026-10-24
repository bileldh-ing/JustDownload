import { JdError } from "./errors";

/**
 * Output filename handling. The user-visible name is display/Content-Disposition metadata only:
 * it never decides a filesystem path (storage keys are server-generated random ids).
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const MAX_BASE_BYTES = 120;

function truncateUtf8(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= maxBytes) return s;
  let out = "";
  for (const ch of s) {
    if (enc.encode(out + ch).length > maxBytes) break;
    out += ch;
  }
  return out;
}

/** Sanitize a base name (no extension). Returns "" if nothing usable is left. */
export function sanitizeBaseName(input: string): string {
  let s = (input ?? "").normalize("NFC");
  // Drop control chars, bidi overrides and zero-width chars, then path separators and reserved punctuation.
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
  s = s.replace(/[\\/:*?"<>|]/g, " ");
  s = s.replace(/\.{2,}/g, ".");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[.\s-]+/, "").replace(/[.\s]+$/, "");
  s = truncateUtf8(s, MAX_BASE_BYTES).trim().replace(/[.\s]+$/, "");
  if (WINDOWS_RESERVED.test(s)) s = `${s}_file`;
  return s;
}

/** Build the final download name with a server-chosen extension. */
export function buildOutputFilename(requested: string | undefined, fallbackTitle: string | undefined, extension: string): string {
  if (!/^[a-z0-9]{1,5}$/.test(extension)) throw new Error("invalid extension");
  let base = requested != null && requested.trim() !== "" ? requested : fallbackTitle ?? "";
  // If the user typed an extension, drop it: the output container decides the extension.
  base = base.replace(/\.(mp4|mkv|webm|mov|m4a|mp3|opus|ogg|wav|flac|aac|m4v|avi)$/i, "");
  const clean = sanitizeBaseName(base);
  if (requested != null && requested.trim() !== "" && !clean) throw new JdError("INVALID_FILENAME");
  return `${clean || "JustDownload media"}.${extension}`;
}

/** Validate a user-requested name strictly (used by the API before job creation). */
export function validateRequestedFilename(name: string): void {
  if (name.length > 200) throw new JdError("INVALID_FILENAME");
  if (/[\\/]/.test(name) || name.includes("\u0000")) throw new JdError("INVALID_FILENAME");
  if (!sanitizeBaseName(name)) throw new JdError("INVALID_FILENAME");
}

/** RFC 6266 / RFC 5987 Content-Disposition with an ASCII fallback. */
export function contentDisposition(filename: string): string {
  const ascii = filename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\%;]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
