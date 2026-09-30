// Implements: AGENTS.md §0.2 (no orphan code — every engine module is
// reachable from the package barrel).
//
// Guards the `@buddysaradhi/core` public surface: importing `./index`
// executes every re-export line (covers index.ts) and every engine listed
// here must stay exported.
import { describe, it, expect } from "vitest";
import * as barrel from "./index";

describe("package barrel (./index)", () => {
  it.each([
    // ledger.ts
    "postLedgerEntry",
    "voidEntry",
    "computeBalance",
    "reconcileLedger",
    "computeHash",
    "buildEntryPayload",
    "nextCreatedAtIso",
    "LEDGER_ENTRY_TYPES",
    // ledgerSql.ts (libsql dialect)
    "postLedgerEntrySql",
    "withWriteTx",
    "requireTenantSecretTx",
    // fees.ts (atomic invoice + payment flows)
    "createInvoiceSql",
    "recordPaymentSql",
    "computeInvoiceTamperHash",
    // engines
    "generateBatchInvoices",
    "enqueueNotification",
    "flushNotifications",
    "processReminders",
    "generateReport",
    "searchAll",
    "rebuildSearchIndex",
    "triggerSync",
    "pushSyncOutbox",
    "verifyPin",
    "isLockedOut",
    "setPin",
  ])("exports %s", (name) => {
    expect((barrel as unknown as Record<string, unknown>)[name]).toBeDefined();
  });
});
