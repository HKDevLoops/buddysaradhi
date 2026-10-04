"use client";

// Implements: 08_Settings.md §Help (an in-product answer to "how does this work",
// not a link out of the product) and AGENTS.md §2 Rule 2 (no outbound network
// call, and therefore no documentation site, forum or feature-request form that
// would need one). Implements AGENTS.md §2 Rule 9 (no silent failure — every
// refusal and every reason is stated in words) and 13_UI_Guidelines.md §8.1
// (empty/edge states say what is true, not what would be reassuring).
//
// WHAT THIS SURFACE WAS: three cards linking to `/faq`, `/faq#requests` and
// `/faq#community`. Only `/dashboard`, `(auth)/*` and `/api/*` exist, so all
// three 404'd, and one of them promised a Community Forum for a product whose
// constitution forbids the outbound call a forum needs. A help surface that
// 404s is worse than none: it is the one place a tutor opens AFTER they have
// already hit the wall, and it answered with a broken promise.
//
// So this teaches instead of linking. The content is the product's real
// invariants (append-only ledger and what a void does, backdated payments and
// the PIN, numbers never reused, sessions lock, backups encrypted, no
// telemetry), told in tutor vocabulary — no `BR-`, no `EC-`, no `§`, and no
// claim that does not correspond to something the app enforces. Cross-references
// name real Settings sections that exist: Security, Attendance Rules, Backup &
// Restore, Data & Privacy, Diagnostics.
//
// The design rule this file follows (13_UI_Guidelines.md §20 + DESIGN.md §2.1):
// a definition list, not a card grid. Same-size icon cards were the reason this
// surface looked like a link picker, and a card grid is the wrong shape for
// prose a tutor reads under pressure — the answer has to be scannable in one
// pass, so every row leads with the symptom or the rule in the tutor's words.

import { HelpCircle, ShieldCheck, Stethoscope } from "lucide-react";

/** One flat, scannable row: the term, then the sentence that answers it. */
function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--border-default)] py-3 last:border-b-0">
      <dt className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {term}
      </dt>
      <dd className="mt-1 text-sm leading-relaxed max-w-[68ch]" style={{ color: "var(--text-secondary)" }}>
        {children}
      </dd>
    </div>
  );
}

function Block({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      <h4 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {heading}
      </h4>
      <dl className="border-t border-[var(--border-default)]">{children}</dl>
    </section>
  );
}

export function HelpSection() {
  return (
    <section className="space-y-8 max-w-[52rem]">
      <header className="space-y-2">
        <h3
          className="flex items-center gap-2 text-lg font-medium"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
        >
          <HelpCircle className="w-5 h-5 shrink-0" style={{ color: "var(--text-secondary)" }} aria-hidden="true" />
          How Buddysaradhi works
        </h3>
        <p className="text-sm leading-relaxed max-w-[68ch]" style={{ color: "var(--text-secondary)" }}>
          Everything you need to know about this app is on this page and on the screen where the
          thing happens. Nothing here links away, because this app makes no outbound connections at
          all — there is no manual to send you to, and no address to send a question to.
        </p>
      </header>

      <Block heading="The five screens">
        <Row term="Dashboard">
          What needs you today: who owes money, what came in this month, and the one thing worth
          doing next.
        </Row>
        <Row term="Students">
          Your roster. Add a student, change their details, and open one student to see their fees,
          attendance and notes together.
        </Row>
        <Row term="Attendance">
          Mark who was present for a date and batch, then lock that date once the register is
          final.
        </Row>
        <Row term="Fees">
          Charge a fee, take a payment, and read any student&apos;s ledger. Every entry you make
          here is permanent, which is what makes the numbers trustworthy at month end.
        </Row>
        <Row term="Settings">
          Your institute name and defaults, fee and attendance rules, your PIN, backups,
          appearance, and a diagnostics panel that tells you the app&apos;s own health.
        </Row>
      </Block>

      <Block heading="The rules that actually bite">
        <Row term="Nothing in your books is ever edited or deleted">
          A mistake is corrected by adding a new entry that reverses it, so both the mistake and
          the correction stay on the record forever. To fix a payment: void it, then record it
          again. There is no &ldquo;delete payment&rdquo; button, and that is the feature.
        </Row>
        <Row term="Voiding does not delete the receipt">
          The original payment stays in the ledger, struck through, with a reversing entry against
          it, and the balance returns to what it was before you took the money.
        </Row>
        <Row term="Receipt and invoice numbers are never reused">
          Voiding leaves a gap in your numbering, and that gap is the evidence that the receipt was
          never handed out twice. Do not close it up.
        </Row>
        <Row term="A payment dated in the past asks for your PIN">
          Changing a month you have already closed needs proof that it is you, not someone at an
          open screen. Set a PIN in Settings &rarr; Security first: without one, backdated payments
          cannot be saved at all.
        </Row>
        <Row term="Attendance locks itself">
          After the window you set in Settings &rarr; Attendance Rules (48 hours by default), a
          date is final and changing it needs your PIN. This is what stops yesterday&apos;s
          register from disagreeing with today&apos;s totals. To fix a date you locked by mistake,
          unlock it from the same sheet.
        </Row>
        <Row term="Backups are encrypted">
          A backup file is unreadable without the passphrase you chose — not by you, not by anyone
          else. Keep that passphrase somewhere you will actually find it. There is no reset and no
          recovery, because a reset would defeat the encryption.
        </Row>
        <Row term="Nothing you type is sent to us">
          No analytics, no tracking, no crash reporting, no accounts holding your roster. The only
          thing that ever leaves this app is an encrypted backup, to wherever you choose to put it.
          That is also why we cannot see your data, and why we cannot recover it for you.
        </Row>
      </Block>

      <Block heading="When something looks wrong">
        <Row term="A payment will not save">
          Nothing was written and your form still holds what you typed. Check the amount, and if
          the date is in the past, check your PIN.
        </Row>
        <Row term="A balance looks wrong">
          Balances are derived from the ledger, so the ledger is the answer. Open that
          student&apos;s ledger and read the entries oldest at the bottom. Void the entry that was
          wrong; never delete it.
        </Row>
        <Row term="A receipt number is missing">
          A gap means that receipt was voided. Look for the reversing entry in the ledger — it names
          the original receipt and why it was reversed.
        </Row>
        <Row term="Attendance for a date will not change">
          The session is locked. Unlock it with your PIN; the marks are all still there.
        </Row>
        <Row term="A screen says it could not load">
          That list is not empty and nothing was changed. Use the retry button on the message, and
          do not re-enter what you were typing — the app cannot tell a failed load from a clean
          slate.
        </Row>
        <Row term="You need to prove what your books say">
          Settings &rarr; Backup &amp; Restore writes an encrypted copy of everything. Settings
          &rarr; Diagnostics reports the app&apos;s own health if you suspect it is the app rather
          than the data.
        </Row>
      </Block>

      <footer
        className="space-y-2 rounded-xl border p-4"
        style={{ borderColor: "var(--border-default)", background: "var(--surface-inset)" }}
      >
        <h4 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: "var(--info)" }} aria-hidden="true" />
          What this app cannot help with
        </h4>
        <p className="text-sm leading-relaxed max-w-[68ch]" style={{ color: "var(--text-secondary)" }}>
          There is no user manual, no support forum, no bug tracker and no feature-request form
          inside Buddysaradhi, and no email address to send them to — a build that never calls out
          cannot receive anything. So there is no link here pretending otherwise.
        </p>
        <p className="flex items-start gap-2 text-sm leading-relaxed max-w-[68ch]" style={{ color: "var(--text-secondary)" }}>
          <Stethoscope className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
          <span>
            If something above is still unclear, or the screen where the problem happened says
            nothing useful about it, that is a gap in this build — worth raising with whoever gave
            you this copy of Buddysaradhi. Where a question has no honest answer here, we have said
            so rather than pointing you somewhere empty.
          </span>
        </p>
      </footer>
    </section>
  );
}
