/**
 * Fixed-window rate limiter keyed by an opaque client id. In-memory per process: it protects one
 * worker instance from bursts; multi-instance deployments should also limit at the edge.
 */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  take(key: string, now = Date.now()): boolean {
    const e = this.hits.get(key);
    if (!e || e.reset <= now) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      if (this.hits.size > 50_000) this.prune(now);
      return true;
    }
    e.n++;
    return e.n <= this.limit;
  }
  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }
}
