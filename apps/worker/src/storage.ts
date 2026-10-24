import { createReadStream, type ReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { newId } from "@justdownload/core/node";

/**
 * Artifact storage abstraction. Keys are server-generated (`<jobId>/<random>`), never derived from
 * user-supplied names. LocalStorage is for development and single-host deployments; an
 * S3-compatible adapter can implement the same interface (not included in this milestone).
 */
export interface ArtifactStorage {
  put(jobId: string, localPath: string): Promise<{ key: string; size: number }>;
  stat(key: string): Promise<{ size: number } | null>;
  read(key: string): ReadStream;
  delete(key: string): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9_-]{16,64}\/[A-Za-z0-9_-]{16,64}$/;

export class LocalStorage implements ArtifactStorage {
  constructor(private readonly root: string) {}
  private resolve(key: string): string {
    if (!KEY_RE.test(key)) throw new Error("invalid storage key");
    const p = path.join(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("storage key escapes root");
    return p;
  }
  async put(jobId: string, localPath: string) {
    const key = `${jobId}/${newId(16)}`;
    const dest = this.resolve(key);
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    try {
      await rename(localPath, dest);
    } catch {
      await copyFile(localPath, dest);
      await unlink(localPath).catch(() => undefined);
    }
    const s = await stat(dest);
    return { key, size: s.size };
  }
  async stat(key: string) {
    try {
      const s = await stat(this.resolve(key));
      return s.isFile() ? { size: s.size } : null;
    } catch {
      return null;
    }
  }
  read(key: string) { return createReadStream(this.resolve(key)); }
  async delete(key: string) { await rm(this.resolve(key), { force: true }); }
  async deleteJob(jobId: string) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(jobId)) throw new Error("invalid job id");
    await rm(path.join(this.root, jobId), { recursive: true, force: true });
  }
}
