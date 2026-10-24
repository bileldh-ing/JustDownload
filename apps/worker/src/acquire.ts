import { constants, createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { JdError } from "@justdownload/core";
import { safeFetch, totalSizeFromHeaders, type SafeFetchOptions } from "@justdownload/core/node";

export interface AcquireResult {
  bytes: number;
  total: number | null;
  contentType: string | null;
  acceptRanges: boolean;
  finalHost: string;
  status: number;
  truncated: boolean;
}

/**
 * Stream a remote resource into a NEW file (O_EXCL | O_NOFOLLOW, so it never overwrites or follows
 * a symlink). Enforces a byte cap while streaming; nothing is buffered in memory.
 * With `headOnly`, at most `maxBytes` are read and the result is marked truncated instead of failing.
 */
export async function acquireToFile(
  url: string,
  dest: string,
  opts: SafeFetchOptions & { maxBytes: number; headOnly?: boolean; onProgress?: (done: number, total: number | null) => void },
): Promise<AcquireResult> {
  const headers: Record<string, string> = {};
  if (opts.headOnly) headers.range = `bytes=0-${opts.maxBytes - 1}`;
  const res = await safeFetch(url, { ...opts, headers });
  if (res.status !== 200 && res.status !== 206) {
    res.body.resume();
    res.body.destroy();
    throw new JdError("SOURCE_HTTP_ERROR", { internal: `status ${res.status}`, retryable: res.status >= 500 || res.status === 429 });
  }
  if (!opts.headOnly && res.status === 206) {
    res.body.destroy();
    throw new JdError("SOURCE_HTTP_ERROR", { internal: "unexpected partial content" });
  }
  const total = totalSizeFromHeaders(res.status, res.headers);
  if (!opts.headOnly && total != null && total > opts.maxBytes) {
    res.body.destroy();
    throw new JdError("SOURCE_TOO_LARGE");
  }
  const contentType = res.headers["content-type"] ? String(res.headers["content-type"]).split(";")[0]!.trim().toLowerCase() : null;
  const fh = await open(dest, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let done = 0;
  let truncated = false;
  let lastEmit = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (done + chunk.length > opts.maxBytes) {
        if (opts.headOnly) {
          const keep = opts.maxBytes - done;
          done += keep;
          truncated = true;
          this.push(chunk.subarray(0, keep));
          this.push(null);
          res.body.destroy();
          return cb();
        }
        return cb(new JdError("SOURCE_TOO_LARGE"));
      }
      done += chunk.length;
      const now = Date.now();
      if (opts.onProgress && now - lastEmit > 250) {
        lastEmit = now;
        opts.onProgress(done, total);
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(res.body, limiter, createWriteStream("", { fd: fh.fd, autoClose: false }), { signal: opts.signal });
  } catch (e) {
    if (!(truncated && opts.headOnly)) {
      if (e instanceof JdError) throw e;
      if ((e as { name?: string }).name === "AbortError") throw new JdError("CANCELLED");
      throw new JdError("SOURCE_UNREACHABLE", { internal: (e as { code?: string }).code ?? "stream error" });
    }
  } finally {
    await fh.close().catch(() => undefined);
  }
  if (!opts.headOnly && total != null && done !== total) throw new JdError("SOURCE_UNREACHABLE", { internal: `short read ${done}/${total}` });
  opts.onProgress?.(done, total);
  if (opts.headOnly && total != null && done < total) truncated = true;
  if (opts.headOnly && res.status === 200 && total == null && done >= opts.maxBytes) truncated = true;
  return {
    bytes: done, total, contentType,
    acceptRanges: res.status === 206 || String(res.headers["accept-ranges"] ?? "").toLowerCase() === "bytes",
    finalHost: res.finalUrl.hostname, status: res.status, truncated,
  };
}
