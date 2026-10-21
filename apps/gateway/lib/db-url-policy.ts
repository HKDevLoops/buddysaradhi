// Implements: 10_Security.md §7 (a tenant-scoped endpoint that can be made to
// reach anything is not scoped) + AGENTS.md §2 Rule 2 (the only permitted
// outbound calls are the ones the product declares) + Rule 9 (fail closed).
//
// ── WHAT THIS GUARDS ───────────────────────────────────────────────────────────
//
// The gateway takes the tenant database's location from the request:
// `x-db-url` (index.ts). That value reaches `resolveTursoUrl` (lib/sql.ts) and
// is then DIALLED — twice, actually:
//
//   1. `getTurso` → `createLibsql({ url })` → the hrana HTTP client POSTs to
//      `${url}/v2/pipeline`;
//   2. `ensureSelfRepairingSchema` → `batchExecute` → `fetch(`${url}/v2/pipeline`)`.
//
// `resolveTursoUrl` allowlists the SCHEME (`libsql:` / `http:` / `https:`) and
// excludes URLs that contain `supabase.co`. It does NOT constrain the HOST.
//
// MEASURED on the local rig (a caller-signed request, so an authenticated
// caller with a valid signature):
//
//   x-db-url: http://127.0.0.1:9097   → the gateway DIALED it and POSTed
//        POST /v2/pipeline
//        authorization: Bearer <the caller's db token>
//        body: {"requests":[{"type":"execute","stmt":{"sql":"SELECT * FROM students
//              WHERE tenant_id = ? ...","args":[...]}}, ...]}
//
//   x-db-url: http://169.254.169.254/latest/meta-data/ → DIALED (no answer here)
//   x-db-url: http://10.0.0.5:8080                    → DIALED, and the request HUNG
//              (the libsql client has no connect timeout, so the isolate sat on
//              the TCP timeout)
//
// So a caller who can get a signature over an arbitrary `x-db-url` — which the
// web app does, because `getDbCredentials` (apps/web/src/lib/db.ts:153) reads
// `db_url` straight out of `user_metadata`, which the signed-in tutor owns —
// can make the EDGE FUNCTION issue HTTP requests to arbitrary hosts, including
// the link-local metadata address and RFC1918 addresses, and can pin an
// isolate on an unreachable host.
//
// This module is the host-side constraint the scheme allowlist cannot express.
//
// WHAT IT REJECTS. Any destination that is not a routable public host:
// loopback, link-local (169.254.0.0/16 — the cloud metadata service), private
// (RFC1918), carrier-grade NAT, multicast/reserved, the IPv6 equivalents, and
// the well-known local/internal hostnames. `libsql:` is a Turso scheme and is
// always a public host.
//
// WHAT IT DOES NOT DO. It does not resolve DNS. A public hostname that
// resolves to a private address (DNS rebinding) is NOT caught here — resolving
// it would add a DNS round trip to every request and a TOCTOU window between
// the check and the dial. The strong control is the operator allowlist below,
// which is a HOSTNAME allowlist and therefore immune to both.
//
// OPERATOR CONTROL. `DB_HOST_ALLOWLIST` (comma-separated hostname suffixes)
// switches the module from the built-in denylist to a strict allowlist: when
// it is set, only a host ending in one of the listed suffixes is permitted.
// A deployment that knows its tenant database hostnames (e.g. `.turso.io`)
// should set it. When it is unset, the denylist applies.
import { z } from "zod";

/** The schemes the gateway will dial. Mirrors `resolveTursoUrl`'s accepted
 *  set (lib/sql.ts) plus `libsql:` — the Turso scheme. `file:` and every other
 *  scheme are refused: they are not a network location, and a local-file
 *  target is a read of the edge's own disk. */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "libsql:"]);

const DbUrlSchema = z.string().min(1).max(2048);

/** Hostnames that always mean "this machine" or "this network". */
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

/** Suffixes that only ever resolve inside a private network. */
const LOCAL_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

export type DbUrlDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

function readEnv(name: string): string {
  if (typeof Deno === "undefined") return "";
  try {
    return Deno.env.get(name) || "";
  } catch {
    return "";
  }
}

/** Operator-configured hostname allowlist (suffixes). Empty = denylist mode. */
function hostAllowlist(): string[] {
  return readEnv("DB_HOST_ALLOWLIST")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/** True when `host` is an IPv4 literal in a non-public range. */
export function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  if (!parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const n = parts.map((p) => Number(p));
  if (n.some((v) => v > 255)) return false;
  const [a, b] = n;
  if (a === 0) return true; // 0.0.0.0/8   "this network"
  if (a === 10) return true; // 10.0.0.0/8  private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** True when `host` is an IPv6 literal that is not a routable public address. */
export function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!h.includes(":")) return false;
  if (h === "::" || h === "::1") return true; // unspecified / loopback
  if (h.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(h)) return true; // fc00::/7 unique-local
  if (h.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d) — unwrap and apply the v4 rules.
  const mapped = h.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/** True when the host is one this module refuses to dial. */
export function isForbiddenHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h.length === 0) return true;
  if (LOCAL_HOSTNAMES.has(h)) return true;
  if (LOCAL_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix))) return true;
  if (isPrivateIpv4(h)) return true;
  if (isPrivateIpv6(h)) return true;
  return false;
}

/**
 * Decide whether the gateway may dial `rawUrl` as a tenant database location.
 *
 * An EMPTY url means "no `x-db-url` header" — the gateway then uses its own
 * configured database, which is always allowed.
 *
 * The decision is made from the PARSED url, so userinfo tricks
 * (`http://127.0.0.1:9097@evil.example.com/`) are judged on the real host
 * (`evil.example.com`), not on the part an attacker wants you to read.
 */
export function checkDbUrl(rawUrl: string | null | undefined): DbUrlDecision {
  const raw = (rawUrl ?? "").trim();
  if (raw.length === 0) return { allowed: true };

  const parsed = DbUrlSchema.safeParse(raw);
  if (!parsed.success) {
    return { allowed: false, reason: "database URL is malformed" };
  }

  let url: URL;
  try {
    url = new URL(parsed.data);
  } catch {
    return { allowed: false, reason: "database URL is malformed" };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return {
      allowed: false,
      reason: `database URL scheme "${url.protocol}" is not a permitted network location`,
    };
  }

  const host = url.hostname.toLowerCase();
  const allowlist = hostAllowlist();
  if (allowlist.length > 0) {
    const permitted = allowlist.some((suffix) =>
      host === suffix || host.endsWith(suffix.startsWith(".") ? suffix : `.${suffix}`)
    );
    if (!permitted) {
      return {
        allowed: false,
        reason: "database URL host is not in the deployment's DB_HOST_ALLOWLIST",
      };
    }
    return { allowed: true };
  }

  if (isForbiddenHost(host)) {
    return {
      allowed: false,
      reason: "database URL host is not a public routable address",
    };
  }
  return { allowed: true };
}
