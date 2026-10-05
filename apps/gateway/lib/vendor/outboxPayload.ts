// VENDORED for edge deployability (17_API_Gateway_System.md §5): byte copy of
// `packages/shared/src/outboxPayload.ts`. The Supabase bundler only uploads
// `supabase/functions/<fn>/`, so the gateway cannot import `../../../packages`
// (deploy bundle 400). Keep in sync with the source; gateway tests pin the
// semantics (see `__tests__/fee-strictness.test.ts` outbox assertions).
// Implements: 12_Business_Rules.md BR-SYN-01 (every mutation appends a
// `sync_outbox` row in the same transaction), BR-SYN-02 (`payload` immutable
// once written); AGENTS.md §2 Rule 7 (outbox on every mutation) + §2 Rule 9
// (typed errors, no silent failure).
//
// ONE canonical outbox codec (P3-11): every writer of `sync_outbox` builds its
// `{ table_name, op, payload }` envelope through `encodeOutboxPayload`, which
// accepts a camelCase-or-snake_case row and emits canonical **snake_case** JSON
// with deterministically sorted keys. Before this codec the same
// `table_name = 'ledger_entries'` carried a camelCase Prisma model from
// `packages/core/src/ledger.ts` and snake_case columns from
// `packages/core/src/ledgerSql.ts` — no replay reader exists yet, so the shape
// is unified now, before one is built.
//
// Envelope keys match the `sync_outbox` column contract exactly
// (`migrations/0001_init.sql` §18 + `prisma/schema.prisma` `SyncOutbox` +
// `apps/gateway/lib/schema.ts`): `table_name`, `row_id` (carried by the caller
// as the row id column — NOT inside the envelope), `op` CHECKed to
// `insert | update | soft_delete`, `payload` TEXT holding a JSON object.
// (Row-level reads keep using `schemas/models.ts` `SyncOutboxSchema`, which is
// the Prisma-facing row shape, not the write-path envelope.)
//
// Deno-safe by design: the only import is `zod` (resolved via `deno.json` in
// `@apps/gateway` and via `node_modules` everywhere else), so
// `apps/gateway/routes/*.ts` import this module directly through a relative
// path. `packages/core` cannot (its `tsconfig.json` pins `rootDir: ./src` and
// it carries no `@buddysaradhi/shared` workspace dependency — see
// `packages/core/src/money.ts`): it carries a byte-semantics mirror of this
// codec in `packages/core/src/ledger.ts` with a "keep in sync" note, the same
// pattern as `paiseAdd`/`paiseSub`.
import { z } from "zod";

/** Canonical `sync_outbox.op` values (`migrations/0001_init.sql` §18 CHECK). */
export const OUTBOX_OPS = ["insert", "update", "soft_delete"] as const;

export type OutboxOp = (typeof OUTBOX_OPS)[number];

export const OutboxOpSchema = z.enum(OUTBOX_OPS);

/**
 * Write-path envelope: the exact `{ table_name, op, payload }` triple a
 * `sync_outbox` INSERT carries. `payload` must already be the canonical JSON
 * object string — `encodeOutboxPayload` is the only sanctioned way to build it.
 */
export const OutboxEnvelopeSchema = z.object({
  table_name: z.string().min(1),
  op: OutboxOpSchema,
  payload: z
    .string()
    .refine(
      (s) => {
        try {
          const value: unknown = JSON.parse(s);
          return typeof value === "object" && value !== null && !Array.isArray(value);
        } catch {
          return false;
        }
      },
      { message: "payload must be a JSON object string" },
    ),
});

export type OutboxEnvelope = z.infer<typeof OutboxEnvelopeSchema>;

/**
 * Normalise a writer's op spelling to the canonical CHECK set. `create` /
 * `delete` are the historical gateway spellings (`apps/gateway/routes/
 * students.ts` `recordOutbox`): `create → insert`, `delete → soft_delete`.
 * Anything else (including the out-of-scope `upsert` / `batch_archive`
 * spellings in `routes/settings.ts` and web actions, which the migration CHECK
 * rejects) is a typed throw, never a silent pass-through (Rule 9).
 */
export function normalizeOutboxOp(op: string): OutboxOp {
  const lower = op.toLowerCase();
  if (lower === "create") return "insert";
  if (lower === "delete") return "soft_delete";
  const parsed = OutboxOpSchema.safeParse(lower);
  if (!parsed.success) {
    throw new Error(
      `OUTBOX_OP_INVALID: op must be one of insert/update/soft_delete (aliases create/delete), got ${JSON.stringify(op)}`,
    );
  }
  return parsed.data;
}

/** `tenantId → tenant_id`; already-snake keys pass through untouched. */
function toSnakeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Build the canonical envelope for one outbox row.
 *
 * - `row` is the business row (or row fragment) with camelCase-or-snake_case
 *   keys; only top-level keys are converted — values pass through byte-
 *   untouched (so `Date`s serialise exactly as `JSON.stringify` always did).
 * - Keys are sorted alphabetically after conversion, so the Prisma dialect
 *   (`{ id, tenantId, … }` insertion order) and the SQL dialect
 *   (`{ id, tenant_id, … }` insertion order) emit identical bytes for
 *   identical logical rows.
 * - Two raw keys colliding on one snake key with *different* values is a typed
 *   throw (fail-closed, Rule 9); equal values dedupe (mixed-spelling PATCH
 *   bodies that agree with themselves keep working).
 * - The finished envelope is Zod-validated before return: an invalid envelope
 *   never reaches the INSERT.
 */
export function encodeOutboxPayload(
  table: string,
  op: string,
  row: Record<string, unknown>,
): OutboxEnvelope {
  if (typeof table !== "string" || table.length === 0) {
    throw new Error("OUTBOX_TABLE_INVALID: table_name must be a non-empty string");
  }
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("OUTBOX_ROW_INVALID: row must be a plain object");
  }
  const normalizedOp = normalizeOutboxOp(op);
  const seen = new Map<string, unknown>();
  for (const rawKey of Object.keys(row)) {
    const key = toSnakeKey(rawKey);
    const value: unknown = row[rawKey];
    if (seen.has(key)) {
      const prev: unknown = seen.get(key);
      if (JSON.stringify(prev) !== JSON.stringify(value)) {
        throw new Error(
          `OUTBOX_ROW_CONFLICT: keys collide on column ${JSON.stringify(key)} with different values (12_Business_Rules.md BR-SYN-02)`,
        );
      }
      continue;
    }
    seen.set(key, value);
  }
  const canonical: Record<string, unknown> = {};
  for (const key of [...seen.keys()].sort()) {
    canonical[key] = seen.get(key);
  }
  const envelope = {
    table_name: table,
    op: normalizedOp,
    payload: JSON.stringify(canonical),
  };
  const parsed = OutboxEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    throw new Error(`OUTBOX_ENVELOPE_INVALID: ${parsed.error.message}`);
  }
  return parsed.data;
}
