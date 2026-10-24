/**
 * Container detection from the first bytes of a file. Used by the lightweight inspector (no FFprobe)
 * to say what a link actually serves, independent of its extension or Content-Type header.
 * It identifies the container family only; it never claims codecs, resolution or duration.
 */
export type SniffKind = "video" | "audio" | "audio_or_video" | "manifest" | "document" | "unknown";

export interface SniffResult {
  container: string | null;
  label: string;
  kind: SniffKind;
}

function ascii(b: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...b.subarray(start, start + len));
}

export function sniffContainer(bytes: Uint8Array): SniffResult {
  const b = bytes;
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4).trim().toLowerCase();
    if (brand.startsWith("m4a") || brand === "m4b" || brand === "f4a") return { container: "m4a", label: "MPEG-4 audio (M4A)", kind: "audio" };
    if (brand === "qt") return { container: "mov", label: "QuickTime (MOV)", kind: "audio_or_video" };
    if (brand.startsWith("3g")) return { container: "3gp", label: "3GPP", kind: "audio_or_video" };
    if (brand === "heic" || brand === "mif1" || brand === "avif") return { container: null, label: "Image (HEIF/AVIF)", kind: "document" };
    return { container: "mp4", label: "MPEG-4 (MP4)", kind: "audio_or_video" };
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const head = ascii(b, 0, Math.min(b.length, 64));
    if (head.includes("webm")) return { container: "webm", label: "WebM", kind: "audio_or_video" };
    return { container: "mkv", label: "Matroska (MKV)", kind: "audio_or_video" };
  }
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF") {
    const t = ascii(b, 8, 4);
    if (t === "WAVE") return { container: "wav", label: "WAV audio", kind: "audio" };
    if (t === "AVI ") return { container: "avi", label: "AVI", kind: "audio_or_video" };
    if (t === "WEBP") return { container: null, label: "Image (WebP)", kind: "document" };
  }
  if (b.length >= 4 && ascii(b, 0, 4) === "OggS") return { container: "ogg", label: "Ogg", kind: "audio_or_video" };
  if (b.length >= 4 && ascii(b, 0, 4) === "fLaC") return { container: "flac", label: "FLAC audio", kind: "audio" };
  if (b.length >= 3 && ascii(b, 0, 3) === "ID3") return { container: "mp3", label: "MP3 audio", kind: "audio" };
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xf6) === 0xf0) return { container: "aac", label: "AAC (ADTS) audio", kind: "audio" };
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return { container: "mp3", label: "MPEG audio (MP3)", kind: "audio" };
  if (b.length >= 189 && b[0] === 0x47 && b[188] === 0x47) return { container: "mpegts", label: "MPEG transport stream", kind: "audio_or_video" };
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0xba) return { container: "mpeg", label: "MPEG program stream", kind: "audio_or_video" };
  if (b.length >= 4 && ascii(b, 0, 3) === "FLV") return { container: "flv", label: "Flash Video (FLV)", kind: "audio_or_video" };

  const text = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, Math.min(b.length, 512))).trimStart().toLowerCase();
  if (text.startsWith("#extm3u")) return { container: null, label: "HLS streaming playlist", kind: "manifest" };
  if (text.startsWith("<?xml") && text.includes("<mpd")) return { container: null, label: "DASH streaming manifest", kind: "manifest" };
  if (text.startsWith("<mpd")) return { container: null, label: "DASH streaming manifest", kind: "manifest" };
  if (text.startsWith("<!doctype html") || text.startsWith("<html") || text.includes("<head")) return { container: null, label: "Web page (HTML)", kind: "document" };
  if (text.startsWith("%pdf")) return { container: null, label: "PDF document", kind: "document" };
  if (text.startsWith("{") || text.startsWith("[")) return { container: null, label: "JSON data", kind: "document" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { container: null, label: "Image (JPEG)", kind: "document" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return { container: null, label: "Image (PNG)", kind: "document" };
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return { container: null, label: "ZIP archive", kind: "document" };
  return { container: null, label: "Unrecognised data", kind: "unknown" };
}
