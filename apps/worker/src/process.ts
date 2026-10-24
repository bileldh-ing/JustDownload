import { spawn } from "node:child_process";

/**
 * Run an executable with an argument ARRAY (shell: false). Kills the whole process group on
 * timeout or abort. Collects a bounded tail of stderr for operator diagnostics only.
 */
export interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  cwd?: string;
  onStdoutLine?: (line: string) => void;
  maxStderrBytes?: number;
  maxStdoutBytes?: number;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export function runProcess(cmd: string, args: readonly string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return resolve({ code: null, signal: null, stdout: "", stderr: "", timedOut: false, aborted: true });
    let child;
    try {
      child = spawn(cmd, args as string[], { shell: false, cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" } });
    } catch (e) {
      return reject(e);
    }
    const maxErr = opts.maxStderrBytes ?? 16 * 1024;
    const maxOut = opts.maxStdoutBytes ?? 4 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let lineBuf = "";
    let timedOut = false;
    let aborted = false;
    const kill = () => {
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, opts.timeoutMs);
    const onAbort = () => { aborted = true; kill(); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      if (stdout.length < maxOut) stdout += d;
      if (opts.onStdoutLine) {
        lineBuf += d;
        let i;
        while ((i = lineBuf.indexOf("\n")) >= 0) {
          opts.onStdoutLine(lineBuf.slice(0, i).replace(/\r$/, ""));
          lineBuf = lineBuf.slice(i + 1);
        }
      }
    });
    child.stderr.on("data", (d: string) => {
      stderr += d;
      if (stderr.length > maxErr) stderr = stderr.slice(-maxErr);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (lineBuf && opts.onStdoutLine) opts.onStdoutLine(lineBuf);
      resolve({ code, signal: sig, stdout, stderr, timedOut, aborted });
    });
  });
}
