// Implements: 12_Business_Rules.md BR-LED-06 (the chain of one student is a
// LINKED LIST and the links ARE the order; a writer extends the chain at its
// tip with a `created_at` strictly greater than the tip's; a FORK is an
// integrity violation, not an ordering artefact) + 10_Security.md §9.4 (the
// integrity violation is reported) — the gateway's mirror of the rule, whose
// reference implementation is `packages/core/src/ledger.ts`
// (`nextChainCreatedAtIso`, `reconcileLedger`).
//
// WHY THIS FILE EXISTS. The gateway is the last writer that did not implement
// the rule: its chain mirror (`apps/gateway/lib/ledger-chain.ts`) broke a
// same-millisecond tie by `rowid` and minted its timestamps from a per-PROCESS
// clock, so two edge isolates (or the gateway and the web, which write the
// same tenant database) could mint the same millisecond and leave the
// timestamp order disagreeing with the link order.
//
// The negative control is the second test: with the per-process clock in
// place of the per-chain clock, the gateway's next row lands BEFORE the tip
// it extends, and the assertion goes RED. Every test runs against the REAL
// handler over in-memory SQLite carrying the gateway's own DDL
// (AGENTS.md §7.3 — never mock the ledger).
import { describe, expect, it } from "vitest";
import { handleLedger } from "../routes/ledger.ts";
import { computeChainHash, ledgerEntryPayload, verifyChainLinks } from "../lib/ledger-chain.ts";
import type { SqlHandle } from "../lib/sql.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

async function post(
  fixture: LedgerFixture,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: ApiBody }> {
  const req = new Request(`https://api.buddysaradhi.app${path}`, {
    method: "POST",
    // RFC-004 C1 — the gateway is fail-closed on keyless mutations, so every
    // test intent mints a FRESH key (reusing one would replay, not re-execute).
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const res = await handleLedger(
    req,
    fixture.db as unknown as DB,
    fixture.tenantId,
    path,
    "POST",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error(`no route matched POST ${path}`);
  return { status: res.status, body: await res.json() as ApiBody };
}

function rows(fixture: LedgerFixture, sql: string, args: unknown[] = []): Record<string, unknown>[] {
  return fixture.db.query(sql, args);
}

/** The chain rows, in the order the database returns them. */
function chainRows(fixture: LedgerFixture): Record<string, unknown>[] {
  return rows(
    fixture,
    "SELECT id, prev_hash, this_hash, created_at, type FROM ledger_entries WHERE student_id = ?",
    [fixture.studentId],
  );
}

/**
 * Insert one chain row directly, with a chosen `created_at`.
 *
 * The row is hash-linked with the gateway's OWN primitives
 * (`computeChainHash` + `ledgerEntryPayload`), so it is a legitimate row of
 * the chain and not a forgery — the point of the tests below is the ORDER and
 * the LINKS, not the hash.
 */
function insertChainRow(
  fixture: LedgerFixture,
  args: {
    id: string;
    type: string;
    debitPaise: number;
    creditPaise: number;
    balanceAfterPaise: number;
    createdAt: string;
    prevHash: string | null;
    occurredOn?: string;
  },
): void {
  const occurredOn = args.occurredOn ?? args.createdAt.slice(0, 10);
  const payload = ledgerEntryPayload({
    id: args.id,
    studentId: fixture.studentId,
    type: args.type,
    debitPaise: args.debitPaise,
    creditPaise: args.creditPaise,
    balanceAfterPaise: args.balanceAfterPaise,
    occurredOn,
  });
  const thisHash = computeChainHash(args.prevHash, payload, args.createdAt, fixture.tenantSecret);
  fixture.db.raw
    .prepare(
      `INSERT INTO ledger_entries (id, tenant_id, student_id, type, debit_paise, credit_paise,
         balance_after_paise, description, prev_hash, this_hash, occurred_on, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'gateway', ?, ?)`,
    )
    .run(
      args.id,
      fixture.tenantId,
      fixture.studentId,
      args.type,
      args.debitPaise,
      args.creditPaise,
      args.balanceAfterPaise,
      args.prevHash,
      thisHash,
      occurredOn,
      args.createdAt,
      args.createdAt,
    );
}

describe("BR-LED-06 — the gateway's writer extends the chain at its tip", () => {
  it("the new row's created_at is strictly greater than the TIP's, even when the wall clock is behind it", async () => {
    // The case the per-chain logical clock exists for: ANOTHER writer's clock
    // is an hour ahead of this one's. The per-process clock would mint "now"
    // and land the new row BEFORE the tip it extends — the timestamp order
    // and the link order would be two different orders, which is what a
    // reader has to invent a tie-break for.
    const f = createLedgerFixture();
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    insertChainRow(f, {
      id: "018f0000-0000-7000-8000-0000000000a1",
      type: "FEE_CHARGED",
      debitPaise: 1000,
      creditPaise: 0,
      balanceAfterPaise: 1000,
      createdAt: ahead,
      prevHash: null,
    });

    const paid = await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 500 });
    expect(paid.status).toBe(200);

    const written = rows(
      f,
      "SELECT created_at FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED'",
    );
    expect(written.length).toBe(1);
    const writtenAt = Date.parse(String(written[0]?.created_at));
    expect(Number.isNaN(writtenAt)).toBe(false);
    // STRICTLY greater than the tip's — the chain's logical clock.
    expect(writtenAt).toBeGreaterThan(Date.parse(ahead));
  });

  it("the timestamps increase along the LINK order, row after row", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 1000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 2000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 3000 });

    // Walk the links and read the timestamps off the walk.
    const report = await verifyChainLinks(f.db as unknown as SqlHandle, f.tenantId, f.studentId);
    expect(report.fork).toBeNull();
    expect(report.unreachable).toEqual([]);
    expect(report.order.length).toBe(3);

    const createdAt = new Map<string, string>();
    for (const row of chainRows(f)) createdAt.set(String(row.id), String(row.created_at));
    let previous = 0;
    for (const id of report.order) {
      const ms = Date.parse(createdAt.get(id) ?? "");
      expect(Number.isNaN(ms)).toBe(false);
      expect(ms, `row ${id} does not advance the clock`).toBeGreaterThan(previous);
      previous = ms;
    }
    // …and the walk found no timestamp that goes backwards.
    expect(report.timestampTies).toEqual([]);
  });
});

describe("BR-LED-06 — a FORK is an integrity violation, not an ordering artefact", () => {
  /**
   * Two rows claiming the same predecessor: two histories, not a tie.
   *
   * The chain is A → B (A is the genesis row, B claims A). The forked row C
   * claims A as well, so A has TWO successors — which is what a fork is.
   */
  function forkTheChain(f: LedgerFixture): { forked: string[]; predecessor: string } {
    const chain = chainRows(f);
    const genesis = chain.find(
      (row) => row.prev_hash === null || row.prev_hash === undefined,
    );
    const predecessor = String(genesis?.this_hash ?? "");
    const successor = chain.find((row) => String(row.prev_hash ?? "") === predecessor);
    const forkedId = "018f0000-0000-7000-8000-0000000000b1";
    insertChainRow(f, {
      id: forkedId,
      type: "PAYMENT_RECEIVED",
      debitPaise: 0,
      creditPaise: 7000,
      balanceAfterPaise: -7000,
      createdAt: new Date(Date.now() + 5_000).toISOString(),
      prevHash: predecessor,
    });
    // The fork's rows are the two SUCCESSORS of the shared predecessor.
    return { forked: [String(successor?.id ?? ""), forkedId], predecessor };
  }

  it("the link-walk REPORTS the fork instead of resolving it", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 1000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 2000 });
    const { forked } = forkTheChain(f);

    const report = await verifyChainLinks(f.db as unknown as SqlHandle, f.tenantId, f.studentId);
    expect(report.fork).not.toBeNull();
    expect(report.fork?.rowIds.length).toBe(2);
    expect(report.fork?.rowIds).toEqual(expect.arrayContaining(forked));
  });

  it("the void path REPORTS the fork in the audit log — and still completes the void", async () => {
    const f = createLedgerFixture();
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 1000 });
    await post(f, "/api/v1/ledger/payment", { studentId: f.studentId, amount: 2000 });
    const paymentId = String(chainRows(f)[0]?.id ?? "");
    forkTheChain(f);

    const voided = await post(f, "/api/v1/ledger/void", {
      entryId: paymentId,
      reason: "duplicate receipt",
      pinProof: f.pinProof,
    });
    // The correction path stays OPEN: the ledger is append-only (Rule 1), so
    // a void is the only way back and a refused void would leave the books
    // permanently wrong (BR-LED-09's own argument).
    expect(voided.status).toBe(200);

    // …but the fork is REPORTED, never silently resolved (10_Security.md §9.4).
    const violations = rows(
      f,
      "SELECT action, metadata FROM audit_log WHERE action = 'ledger_integrity_violation'",
    );
    expect(violations.length).toBe(1);
    const metadata = JSON.parse(String(violations[0]?.metadata)) as {
      violation: string;
      forked_rows: string[];
    };
    expect(metadata.violation).toBe("chain_fork");
    expect(metadata.forked_rows.length).toBe(2);
  });
});
