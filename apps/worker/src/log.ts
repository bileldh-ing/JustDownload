import { pino, type Logger as PinoLogger } from "pino";

export type Logger = Pick<PinoLogger, "info" | "warn" | "error" | "debug" | "child">;

/**
 * Structured JSON logs. URLs are never logged in full (only redacted host/path), and these paths
 * are scrubbed defensively in case a value slips through.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: "justdownload-worker" },
    redact: { paths: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-jd-session\"]", "*.href", "*.url", "*.sig", "*.token"], censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const silentLogger: Logger = pino({ level: "silent" });
