// Implements: RFC-003 §0/G-DB + workstream E (cache-first reads are budget
// controls on Supabase Free: every cache hit saves an Edge invocation slice +
// Turso rows-read; 17_API_Gateway_System.md §6.3 reference-data TTLs).
//
// Budget rule: REFERENCE ROWS ONLY. Ledger entries, invoices with derived
// paid-amounts, balances, and analytics aggregates are money views — they are
// never cached beyond request scope (a stale balance is a livelihood bug,
// BR-M-01). `isCacheablePath` is the allowlist index.ts consults; anything
// not listed falls through to Turso on every request.
const MAX_ENTRIES = 512;
/** RFC-003 G-DB reference-data TTL: 63s, tenant-scoped keys. */
export const REFERENCE_TTL_MS = 63_000;
const DEFAULT_TTL_MS = REFERENCE_TTL_MS;
const STALE_GRACE_MS = 10_000;

interface LRUNode {
  key: string;
  body: string;
  contentType: string;
  status: number;
  expiresAt: number;
  staleAt: number;
  prev: LRUNode | null;
  next: LRUNode | null;
}

const nodeMap = new Map<string, LRUNode>();
let head: LRUNode | null = null;
let tail: LRUNode | null = null;

function moveToFront(node: LRUNode): void {
  if (node === head) return;
  if (node.prev) node.prev.next = node.next;
  if (node.next) node.next.prev = node.prev;
  if (node === tail) tail = node.prev;
  node.prev = null;
  node.next = head;
  if (head) head.prev = node;
  head = node;
  if (!tail) tail = node;
}

function removeNode(node: LRUNode): void {
  if (node.prev) node.prev.next = node.next;
  if (node.next) node.next.prev = node.prev;
  if (node === head) head = node.next;
  if (node === tail) tail = node.prev;
}

function evict(): void {
  if (!tail) return;
  nodeMap.delete(tail.key);
  removeNode(tail);
}

export function invalidatePattern(pattern: string): void {
  const regex = new RegExp(pattern);
  for (const [key, node] of nodeMap) {
    if (regex.test(key)) {
      nodeMap.delete(key);
      removeNode(node);
    }
  }
}

export function invalidateTenant(tenantId: string): void {
  invalidatePattern(tenantId);
}

export function getCachedResponse(key: string): Response | null {
  const node = nodeMap.get(key);
  if (!node) return null;
  const now = performance.now();
  if (now > node.staleAt) {
    nodeMap.delete(key);
    removeNode(node);
    return null;
  }
  moveToFront(node);
  const age = Math.round((now - (node.expiresAt - DEFAULT_TTL_MS)) / 1000);
  const headers: Record<string, string> = {
    "Content-Type": node.contentType,
    "X-Cache": now > node.expiresAt ? "STALE" : "HIT",
    "X-Cache-Age": String(age),
    "Cache-Control": `public, max-age=${Math.max(0, Math.round((node.expiresAt - now) / 1000))}, stale-while-revalidate=${STALE_GRACE_MS / 1000}`,
  };
  return new Response(node.body, { status: node.status, headers });
}

export function setCacheResponse(
  key: string,
  body: string,
  status: number,
  contentType: string,
  ttlMs = DEFAULT_TTL_MS,
): void {
  const existing = nodeMap.get(key);
  if (existing) {
    existing.body = body;
    existing.status = status;
    existing.contentType = contentType;
    existing.expiresAt = performance.now() + ttlMs;
    existing.staleAt = performance.now() + ttlMs + STALE_GRACE_MS;
    moveToFront(existing);
    return;
  }
  if (nodeMap.size >= MAX_ENTRIES) evict();
  const now = performance.now();
  const node: LRUNode = {
    key,
    body,
    contentType,
    status,
    expiresAt: now + ttlMs,
    staleAt: now + ttlMs + STALE_GRACE_MS,
    prev: null,
    next: head,
  };
  if (head) head.prev = node;
  head = node;
  if (!tail) tail = node;
  nodeMap.set(key, node);
}

export function cacheStats() {
  return { size: nodeMap.size, max: MAX_ENTRIES };
}

/**
 * Edge-cache allowlist (RFC-003 workstream E §3 + Rule 4 — no new paths, so
 * this list only names contracted GETs). Reference reads: students list +
 * detail, attendance batch reference, settings, notification feed. Money
 * views (`/api/v1/ledger*`, `/api/v1/analytics/*`, `/api/v1/sync/*`) are
 * deliberately absent — they always read through to the tenant DB.
 */
const CACHEABLE_GET_PREFIXES = [
  "/api/v1/students",
  "/api/v1/attendance/batches",
  "/api/v1/settings",
  "/api/v1/notifications",
] as const;

export function isCacheablePath(path: string): boolean {
  return CACHEABLE_GET_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix + "/"),
  );
}

// Backward-compatible aliases used by route handlers.
// Routes store plain objects; this serializes to/from the internal string cache.
export function getCached<T = unknown>(key: string): T | null {
  const node = nodeMap.get(key);
  if (!node) return null;
  const now = performance.now();
  if (now > node.staleAt) {
    nodeMap.delete(key);
    removeNode(node);
    return null;
  }
  moveToFront(node);
  try {
    return JSON.parse(node.body) as T;
  } catch {
    return null;
  }
}

export function setCache(key: string, data: unknown, ttlMs = DEFAULT_TTL_MS): void {
  const body = JSON.stringify(data);
  setCacheResponse(key, body, 200, "application/json", ttlMs);
}
