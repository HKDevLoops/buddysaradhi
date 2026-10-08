"use client";

// Implements: AGENTS.md §2 Rule 9 (no fabricated result), §6.4 SOVEREIGN (the
// tenant's data is the tenant's), §8 stop-and-ask #2/#12 (no new network call,
// no new dependency), and 08_Settings.md §6.2.10's identity fields as far as the
// web ORM shim can honestly supply them.
//
// WHAT THIS SECTION USED TO BE: a password box and a "Test Connection" button
// that waited 900ms and then printed "Connection successful (mock)". The card
// around it said "Demo only", which is better than nothing, but the button still
// performed the one thing a tutor must never be able to trust: it reported a
// connection that was never made. It is gone.
//
// What replaces it is the truth about where a tutor's records actually live and
// how much of them there is: one database, per account, identified by tenant id,
// holding students, ledger entries, invoices and one settings row. Those counts
// come from real COUNT queries (ORM `count`, AGENTS §3.4 — no raw SQL).
//
// REPORTED, NOT IMPLEMENTED: 08 §6.2.10 / SR-08 want the masked `db_url` behind
// a PIN-gated reveal, plus `schema_version`. Neither is reachable from the web
// ORM shim: it exposes six models and no `appState`, and the db URL lives in
// Supabase user metadata behind `lib/db.ts` (another lane's file). Those need a
// shim model + an identity source before the fields can be honest.

import { useQuery } from "@tanstack/react-query";
import { Database, Info, HardDrive, ScrollText } from "lucide-react";
import { getDbIdentityAction, type DbIdentityResult } from "@/server/actions/settings";

/** The success branch of the action's discriminated union, named for the UI. */
type DbIdentitySuccess = Extract<DbIdentityResult, { success: true }>;

/**
 * One measured fact, as a labelled row.
 *
 * `valueId` IS THE CONTRACT, and it exists because of a concrete measurement
 * failure: the settings audit read these counts by scraping the row's `innerText`
 * with `/[\d,]+/`, which also matches a bare comma. "Ledger entries / 34 /
 * Append-only. A correction is a new entry beside the old one, **,** never a
 * change to it." yielded the matches `["34", ","]`, and the helper took the last
 * one — `Number(",".replace(/,/g, ""))` is `Number("")` which is `0`. The ledger
 * count was read as zero, `0 >= 15` was false, and the section that was in fact
 * perfectly healthy failed with "invoices are backed by ledger rows". A number
 * that appears next to prose can be scraped wrong; a number at a stable id cannot
 * be read at all if it is absent. Every count row therefore carries an id on the
 * VALUE element specifically — not the row — so a reader cannot pick up the hint.
 */
function Row({
  label,
  value,
  valueId,
  hint,
}: {
  label: string;
  value: string;
  valueId: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-2 border-b border-[var(--border-default)] last:border-b-0">
      <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
      <span
        id={valueId}
        data-db-count="true"
        className="text-sm font-mono text-[var(--text-primary)] text-right break-all"
      >
        {value}
      </span>
      {hint ? <span className="w-full text-xs text-[var(--text-muted)]">{hint}</span> : null}
    </div>
  );
}

const nf = new Intl.NumberFormat("en-IN");

export function DatabaseSection() {
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ["db-identity"],
    queryFn: () => getDbIdentityAction(),
  });

  // The action's two shapes share field names, so the success branch is named
  // explicitly rather than relied upon to be inferred through `useQuery`. A null
  // count can then never reach `Intl.NumberFormat`.
  const ok: DbIdentitySuccess | null =
    data?.success === true && typeof data.tenantId === "string" && typeof data.students === "number"
      ? (data as DbIdentitySuccess)
      : null;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6 max-w-2xl">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
          <Database className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
          Where your records live
        </h3>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-[68ch]">
          Everything you record belongs to this account and one database that belongs to this
          account only. You cannot point Buddysaradhi at a shared database, and nothing you write
          is visible to another tutor.
        </p>
      </div>

      <div
        className="rounded-xl border border-[color-mix(in_srgb,var(--info)_25%,transparent)] p-4 flex gap-3"
        style={{ background: "color-mix(in srgb, var(--info) 6%, transparent)" }}
      >
        <Info className="w-5 h-5 text-[var(--info)] shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-[var(--text-secondary)] max-w-[68ch]">
          This build does not let you move or connect to a different database, so there is nothing to
          configure here and nothing to test. What is below is measured from your account.
        </p>
      </div>

      {isError || (data && data.success === false) ? (
        <div className="rounded-xl border border-[var(--border-default)] p-5" style={{ background: "var(--surface-inset)" }}>
          <p role="alert" className="text-sm text-[var(--danger)] font-semibold">
            Could not read your account details. Nothing was changed.
          </p>
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            disabled={isFetching}
            className="neumo-raised mt-4 px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold text-[var(--text-primary)] disabled:opacity-50 cursor-pointer transition-colors hover:brightness-110"
          >
            {isFetching ? "Reading…" : "Read them again"}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-default)] p-5" style={{ background: "var(--surface-inset)" }}>
          <div className="flex items-center gap-3 mb-3">
            <HardDrive className="w-5 h-5 text-[var(--text-secondary)] shrink-0" aria-hidden="true" />
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">This account</h4>
          </div>
          {ok ? (
            <dl>
              <Row valueId="db-count-account-id" label="Account id" value={ok.tenantId} hint="Every row you own carries this id. Quoting it identifies your data and nothing else." />
              <Row valueId="db-count-students" label="Students" value={nf.format(ok.students)} />
              <Row valueId="db-count-ledger-entries" label="Ledger entries" value={nf.format(ok.ledgerEntries)} hint="Append-only. A correction is a new entry beside the old one, never a change to it." />
              <Row valueId="db-count-invoices" label="Invoices" value={nf.format(ok.invoices)} />
              <Row valueId="db-count-settings-row" label="Settings row" value={ok.settingsRows === 1 ? "present" : "not created yet"} />
            </dl>
          ) : (
            <p className="text-sm text-[var(--text-muted)]" aria-live="polite">
              Reading your account details…
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-[var(--border-default)] p-5" style={{ background: "var(--surface-inset)" }}>
        <div className="flex items-center gap-3 mb-2">
          <ScrollText className="w-5 h-5 text-[var(--text-secondary)] shrink-0" aria-hidden="true" />
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">Not shown here</h4>
        </div>
        <p className="text-sm text-[var(--text-secondary)] max-w-[68ch]">
          The database address and schema version are not in this build&apos;s display. If you need
          them for a support conversation, take a backup instead: the file contains your records, so
          it answers the question without exposing a live connection string on a screen.
        </p>
      </div>
    </section>
  );
}