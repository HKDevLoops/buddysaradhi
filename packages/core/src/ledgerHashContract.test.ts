// Implements: 11_Data_Model.md §10.2 (the chain hash is verified in the
// application layer; the SQL trigger is explicitly out of scope) and §8.1 (the
// canonical hash formula), as decided on 2026-10-21
// (docs/audit/REMEDIATION-PLAN-2026-10-21.md row 1.16).
//
// WHY THIS FILE EXISTS. The spec used to describe a `trg_ledger_hash` trigger
// whose byte stream was INCOMPATIBLE with the hash the application computes:
// a different field order, a different separator, the pepper in a different
// position. Installing it as written would have aborted 100 % of ledger
// INSERTs - and it was installed nowhere, so it was a guarantee that read as
// real and protected nothing. The decision was to amend the SPEC (the trigger
// is out of scope) rather than the code.
//
// That decision is only worth anything if it cannot silently rot. Two things
// can rot, and this file watches both:
//
//   1. THE ALGORITHM. A change to the payload's field set or field order
//      changes every existing row's hash - a change to the ledger's FORMAT
//      that needs the review a schema change needs (AGENTS.md §8). The
//      golden vector below fails the moment the byte stream moves.
//   2. THE SPEC. If §10.2 drifts back to describing a trigger, or §9.3 drifts
//      back to a `row_hash` column, the spec is again promising something
//      the product does not do - which is the exact defect this row closed.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildEntryPayload, computeHash } from "./ledger";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../../");

const ENTRY = {
  id: "11111111-1111-4111-8111-111111111111",
  studentId: "22222222-2222-4222-8222-222222222222",
  type: "FEE_CHARGED",
  debitPaise: 150000,
  creditPaise: 0,
  balanceAfterPaise: 150000,
  occurredOn: "2026-09-12",
};
const CREATED_AT = "2026-09-12T10:00:00.000Z";
const SECRET = "test-secret";

/** The payload byte stream the spec documents. */
const PAYLOAD = JSON.stringify({
  id: ENTRY.id,
  studentId: ENTRY.studentId,
  type: ENTRY.type,
  debitPaise: ENTRY.debitPaise,
  creditPaise: ENTRY.creditPaise,
  balanceAfterPaise: ENTRY.balanceAfterPaise,
  occurredOn: ENTRY.occurredOn,
});

describe("the chain hash contract (11_Data_Model.md §8.1 + §10.2, row 1.16)", () => {
  it("hashes the documented byte stream (golden vector)", () => {
    // The genesis row: `prev_hash` is OMITTED, not hashed as an empty string.
    expect(computeHash(null, PAYLOAD, CREATED_AT, SECRET)).toBe(
      "d4d0bd0a83137cd43e531898bf8101aace09eb1f448587900e6a538d464fb26b",
    );
    // A chained row: the predecessor's hash is the FIRST thing hashed.
    expect(computeHash("deadbeef", PAYLOAD, CREATED_AT, SECRET)).toBe(
      "eb78e80133c64230ae0a5815cb2ae00f1ef6893b1f2858a140efdb34c7a22731",
    );
  });

  it("builds the documented payload - the same field set, the same key order", () => {
    expect(buildEntryPayload(ENTRY)).toBe(PAYLOAD);
  });

  it("§10.2 says the hash is verified in the application layer, not by a trigger", () => {
    const dataModel = readFileSync(resolve(REPO, "11_Data_Model.md"), "utf8");
    const section = dataModel.slice(
      dataModel.indexOf("### 10.2"),
      dataModel.indexOf("### 10.3"),
    );
    expect(section).toContain("VERIFIED IN THE APPLICATION LAYER");
    expect(section).toContain("explicitly out of scope");
    // The old trigger - byte-incompatible with the app's hash - must not come
    // back. If it does, an agent will install it and abort every write. The
    // section NAMES the trigger while refusing it, so the signature to look
    // for is the DDL, not the name.
    expect(section).not.toContain("CREATE TRIGGER");
    expect(section).not.toContain("RAISE(ABORT");
  });

  it("§9.3 describes the chain hash, not a row_hash column", () => {
    const security = readFileSync(resolve(REPO, "10_Security.md"), "utf8");
    const section = security.slice(
      security.indexOf("### 9.3"),
      security.indexOf("### 9.4"),
    );
    expect(section).toContain("canonical_payload");
    expect(section).toContain("out of scope");
    // `row_hash` is not a column and never was; naming it as one is the drift
    // this row closed.
    expect(section).not.toMatch(/carries `row_hash`/);
  });
});
