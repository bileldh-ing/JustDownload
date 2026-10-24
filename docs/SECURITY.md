# Security model

## Threats and controls

| Threat | Control | Tests |
|---|---|---|
| SSRF to internal services / cloud metadata | `normalizeUrl` (http/https only, no credentials, ports 80/443, blocked internal names, IP classification incl. IPv4-mapped/compatible IPv6, NAT64, 6to4, CGNAT, link-local, metadata IPs); `safeFetch` resolves DNS, requires **every** answer to be public, pins the socket to the validated IP (rebinding), re-validates every redirect hop | `packages/core/test/url-safety.test.ts` (incl. decimal/hex/octal IPv4, punycode, fuzzing), `safe-fetch.test.ts` |
| Provider ToS bypass | Server-side registry; strict request schemas; options re-derived server-side; restricted platforms answered without any network request | `domain.test.ts`, worker integration tests |
| Command injection | `spawn(..., { shell: false })`, fixed argv built from a server-side allowlist of option ids; user text only ever becomes a single `-metadata title=…` argv element | `media.test.ts`, worker `process runner` test |
| Path traversal / overwrite | Storage keys are random server ids; user filenames only used in `Content-Disposition` (RFC 6266/5987); new files opened with `O_EXCL|O_NOFOLLOW`; per-job private work dirs (0700) | filename fuzz test, storage tests |
| Job enumeration / IDOR | 144-bit random ids; every job/inspection bound to a hashed guest session; "not found" for other sessions; downloads/uploads/SSE use short-lived HMAC capabilities | integration tests |
| CSRF | Cookie-authenticated mutations require same-origin (`Origin` / `Sec-Fetch-Site`); `SameSite=Lax`, `HttpOnly`, `Secure` in production | `apps/web/test/http.test.ts` |
| Resource abuse | Byte caps while streaming, duration cap, upload cap, queue-depth and disk budgets (503 `CAPACITY_EXCEEDED`), per-client rate limits, job timeout, configurable concurrency | integration tests |
| Secret / URL leakage | Tokens only server-side; logs carry host/path only (no query strings, no bodies); pino redaction; client errors never include internals | `errors` tests |
| Content sniffing / XSS | Metadata rendered as text; CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`), `nosniff`, external links `rel="noopener noreferrer"` | — |

## Worker sandbox (deployment)

The Docker image runs as the non-root `node` user with `tini`. `docker-compose.yml` adds
`read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `pids_limit`, memory/CPU limits and an internal
network for Redis. Recommended in production: an egress firewall that only allows outbound 80/443 to
the internet and DNS (deny RFC1918, link-local and metadata ranges), and a separate storage volume with
a quota.

## Known gaps

- Rate limits are per process (no shared limiter).
- No malware scanning of uploads (uploads are only probed and transcoded, never executed or served raw
  except as the user's own converted output).
- No formal penetration test; legal review pending.

Report vulnerabilities privately to the repository owner rather than in public issues.
