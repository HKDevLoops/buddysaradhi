"use client";

// Implements: docs/design/overhaul-plan.md §4.1 (`/request-access`: name, email,
// institute, plan, prepaid billing period, note) + AGENTS.md Rule 10 (44px
// targets, real focus states, errors that name the problem and the recovery).
// Rules live in src/lib/access-request.ts and are shared with the console-backed
// endpoint at src/app/api/access-request/route.ts, so the browser and the endpoint can
// never disagree about what is valid.
// Claims-audit pass (docs/design/marketing-claims-audit.md rows 5–6):
//   · a transport failure is NOT a field error. It used to be reported against
//     the optional `note` box, blaming a field the tutor never had to fill.
//     Validation errors and `transportError` are now separate channels.
//   · the submitted state no longer dead-ends on "Back to plans". It states what
//     actually happened, names the path that works today, and offers a
//     correction for a mistyped email.

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import {
  APP_LOGIN_URL,
  APP_SIGNUP_URL,
  BILLING_PERIODS,
  BILLING_PERIOD_LABEL,
  FREE_SIGNUP_CTA,
  PLAN_CATALOGUE,
  planDefinition,
  validateAccessRequest,
  type AccessRequestErrors,
  type AccessRequestField,
  type AccessRequestReceipt,
  type BillingPeriodId,
  type PlanId,
} from "@/lib/access-request";

type FieldErrors = AccessRequestErrors;
type FormState = "editing" | "sending" | "sent";

const INITIAL_ERRORS: FieldErrors = {};

interface SentCopy {
  readonly heading: string;
  /** Two complete, standalone sentences. No interpolation, so a translator can
   *  reorder them without dragging variables along (clarify.md, Voice). */
  readonly outcome: readonly string[];
  /** True when a correction is a plain re-send because nothing persisted. False
   *  when the request is on file: a correction is a second send that must
   *  mention the first reference. */
  readonly correctionIsSafe: boolean;
}

/**
 * The panel a visitor reads after a successful POST, per delivery outcome.
 *
 * `delivery` is a closed union on `AccessRequestReceipt`. Implementing one member
 * and throwing on the rest means `tsc` fails the moment delivery is widened —
 * the state cannot be shipped with a missing sentence (AGENTS.md Rule 9, and the
 * no-orphan-code rule). Today the outcome is the console: validated, persisted
 * to the access-request store, readable by the owner. Mail delivery to a person
 * is not connected, so we say the request is recorded and will be read — never
 * that an administrator has already been emailed.
 */
function sentCopy(receipt: AccessRequestReceipt): SentCopy {
  switch (receipt.delivery) {
    case "console":
      return {
        heading: "Received. We will reply by email.",
        outcome: [
          "Your request is recorded under the reference below.",
          "An administrator reads every request in the operations console. Nothing is charged.",
        ],
        correctionIsSafe: false,
      };
    default:
      // SAFETY: unreachable while `delivery` is the literal "console". Widen the
      // union in access-request.ts and this becomes the branch that must be
      // written before a request can claim to have reached anyone new.
      throw new Error(
        `access-request.delivery "${String(receipt.delivery)}" has no submitted-state copy`,
      );
  }
}

export function AccessRequestForm() {
  const formId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [plan, setPlan] = useState<PlanId>("institute");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriodId>("annual");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>(INITIAL_ERRORS);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [state, setState] = useState<FormState>("editing");
  const [receipt, setReceipt] = useState<AccessRequestReceipt | null>(null);

  // The free plan costs nothing, so it has no prepaid period. The control stays
  // visible and explains itself rather than hiding a field that was asked for.
  const periodApplies = plan !== "free";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setErrors(INITIAL_ERRORS);
    setTransportError(null);

    const parsed = validateAccessRequest({
      name,
      email,
      instituteName,
      plan,
      billingPeriod: periodApplies ? billingPeriod : null,
      note,
    });

    if (!parsed.ok) {
      setErrors(parsed.error);
      setState("editing");
      return;
    }

    let res: Response;
    let body: unknown;
    try {
      res = await fetch("/api/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.value),
      });
      body = await res.json();
    } catch {
      // Transport failed: the request left the browser but never reached us.
      // That is not any field's fault, and the fields stay exactly as typed so
      // the tutor can fix a real mistake rather than guess at a phantom one.
      setTransportError(
        "Your request did not reach this site. Nothing was sent and nothing was charged. Your answers are still here — check your connection and press Send again.",
      );
      setState("editing");
      return;
    }

    if (!res.ok || typeof body !== "object" || body === null) {
      setTransportError(
        "This site could not accept the request right now. Nothing was sent and nothing was charged. Your answers are still here — try again in a moment.",
      );
      setState("editing");
      return;
    }

    const result = body as
      | { ok: true; receipt: AccessRequestReceipt }
      | { ok: false; errors: AccessRequestErrors };
    if (!result.ok) {
      setErrors(result.errors);
      setState("editing");
      return;
    }
    setReceipt(result.receipt);
    setState("sent");
  }

  if (state === "sent" && receipt) {
    const chosen = planDefinition(plan);
    const periodLabel =
      periodApplies && billingPeriod ? BILLING_PERIOD_LABEL[billingPeriod].toLowerCase() : null;
    const copy = sentCopy(receipt);
    return (
      <div className="panel p-8">
        <h2 className="font-display text-2xl font-bold">{copy.heading}</h2>
        {copy.outcome.map((line) => (
          <p key={line} className="mt-3 max-w-[62ch] text-pretty text-[var(--text-secondary)]">
            {line}
          </p>
        ))}

        {/* What was recorded, as its own block. The values stay separate
            elements so a translator can reorder the labels. */}
        <dl className="mt-6 grid gap-3 border-t pt-5 text-sm" style={{ borderColor: "var(--border-default)" }}>
          <div>
            <dt className="text-[var(--text-muted)]">Reference</dt>
            <dd className="mt-0.5 font-semibold">{receipt.reference}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Plan you asked for</dt>
            <dd className="mt-0.5">
              {chosen.name}
              {periodLabel ? `, on the ${periodLabel} period` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Address you gave us</dt>
            <dd className="mt-0.5 break-words">{email}</dd>
          </div>
        </dl>

        {copy.correctionIsSafe ? (
          <p className="mt-5 max-w-[62ch] text-pretty text-[var(--text-secondary)]">
            If that address is a typo, correct it and send again: nothing is queued, so there is
            nothing to cancel.
          </p>
        ) : (
          <p className="mt-5 max-w-[62ch] text-pretty text-[var(--text-secondary)]">
            If that address is a typo, send the request again with the right address and mention
            this reference. Both stay on file, so the wrong one is never mistaken for you.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <a href={APP_SIGNUP_URL} className="btn btn-primary" rel="noopener">
            {FREE_SIGNUP_CTA}
          </a>
          {/* The account the visitor may already hold, or will hold the moment
              they take the primary. Same single owner for the destination as
              every other app-ward link (APP_LOGIN_URL), plain anchor, no new
              origin. */}
          <a href={APP_LOGIN_URL} className="action inline-flex min-h-[44px] items-center" rel="noopener">
            Sign in
          </a>
          {/* The correction path. The fields are untouched and only the address
              needs editing; sending again records a second row, so the panel
              above says to mention this reference. */}
          <button
            type="button"
            className="action inline-flex min-h-[44px] items-center"
            onClick={() => {
              setReceipt(null);
              setState("editing");
              setTransportError(null);
            }}
          >
            Fix the email and send again
          </button>
          <Link href="/pricing" className="btn btn-secondary">
            Back to plans
          </Link>
        </div>
        <p className="field-hint mt-4">
          Nothing is charged at any point on this page, and no card is asked for.
        </p>
      </div>
    );
  }

  const errorFor = (field: AccessRequestField) => errors[field];
  const describedBy = (field: AccessRequestField) =>
    errorFor(field) ? `${formId}-${field}-error` : undefined;
  const errorCount = Object.keys(errors).length;

  return (
    <form onSubmit={onSubmit} noValidate className="panel p-6 md:p-8">
      {/* Two failure channels, two different sentences. A field that needs
          fixing is counted and attributed; a transport failure says the request
          never arrived and does not point at any input. */}
      {(errorCount > 0 || transportError) && (
        <div
          role="alert"
          className="mb-6 rounded-panel px-4 py-3 text-sm"
          style={{ background: "var(--surface-inset)", color: "var(--danger)" }}
        >
          {errorCount > 0 && (
            <p>
              {errorCount === 1 ? "One field needs fixing" : `${errorCount} fields need fixing`}.
              The request has not been sent.
            </p>
          )}
          {transportError && <p className={errorCount > 0 ? "mt-2" : undefined}>{transportError}</p>}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <label className="field-label" htmlFor={`${formId}-name`}>
            Your name
          </label>
          <input
            id={`${formId}-name`}
            className="input"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errorFor("name") ? true : undefined}
            aria-describedby={describedBy("name")}
          />
          {errorFor("name") && (
            <p className="field-error" id={`${formId}-name-error`}>
              {errorFor("name")}
            </p>
          )}
        </div>

        <div>
          <label className="field-label" htmlFor={`${formId}-email`}>
            Email
          </label>
          <input
            id={`${formId}-email`}
            className="input"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errorFor("email") ? true : undefined}
            aria-describedby={describedBy("email")}
          />
          {errorFor("email") && (
            <p className="field-error" id={`${formId}-email-error`}>
              {errorFor("email")}
            </p>
          )}
        </div>

        <div className="md:col-span-2">
          <label className="field-label" htmlFor={`${formId}-institute`}>
            Institute name
          </label>
          <input
            id={`${formId}-institute`}
            className="input"
            name="instituteName"
            autoComplete="organization"
            value={instituteName}
            onChange={(e) => setInstituteName(e.target.value)}
            aria-invalid={errorFor("instituteName") ? true : undefined}
            aria-describedby={describedBy("instituteName")}
          />
          {errorFor("instituteName") && (
            <p className="field-error" id={`${formId}-instituteName-error`}>
              {errorFor("instituteName")}
            </p>
          )}
        </div>
      </div>

      <fieldset className="mt-6 border-0 p-0">
        <legend className="field-label">Plan</legend>
        <div className="mt-2 grid gap-3">
          {PLAN_CATALOGUE.map((p) => (
            <label
              key={p.id}
              className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-panel px-4 py-3"
              style={{
                background: plan === p.id ? "var(--surface-inset)" : "transparent",
                border: `1px solid ${plan === p.id ? "var(--accent-primary)" : "var(--border-default)"}`,
              }}
            >
              <input
                type="radio"
                name="plan"
                value={p.id}
                checked={plan === p.id}
                onChange={() => setPlan(p.id)}
                className="mt-1"
                style={{ accentColor: "var(--accent-primary)" }}
              />
              <span>
                <span className="block font-semibold">{p.name}</span>
                <span className="mt-0.5 block text-sm text-[var(--text-secondary)]">
                  {p.audience}
                </span>
              </span>
            </label>
          ))}
        </div>
        {errorFor("plan") && <p className="field-error">{errorFor("plan")}</p>}
      </fieldset>

      <fieldset className="mt-6 border-0 p-0" aria-disabled={!periodApplies}>
        <legend className="field-label">Billing period</legend>
        <p className="mb-2 text-sm text-[var(--text-muted)]">
          {periodApplies
            ? "All periods are prepaid."
            : "The free plan has no billing period, so nothing is charged."}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {BILLING_PERIODS.map((period) => (
            <label
              key={period}
              className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-panel px-4 py-3"
              style={{
                background:
                  periodApplies && billingPeriod === period ? "var(--surface-inset)" : "transparent",
                border: `1px solid ${
                  periodApplies && billingPeriod === period
                    ? "var(--accent-primary)"
                    : "var(--border-default)"
                }`,
                opacity: periodApplies ? 1 : 0.55,
              }}
            >
              <input
                type="radio"
                name="billingPeriod"
                value={period}
                checked={periodApplies && billingPeriod === period}
                disabled={!periodApplies}
                onChange={() => setBillingPeriod(period)}
                className=""
                style={{ accentColor: "var(--accent-primary)" }}
              />
              <span>{BILLING_PERIOD_LABEL[period]}</span>
            </label>
          ))}
        </div>
        {errorFor("billingPeriod") && (
          <p className="field-error">{errorFor("billingPeriod")}</p>
        )}
      </fieldset>

      <div className="mt-6">
        <label className="field-label" htmlFor={`${formId}-note`}>
          Anything we should know <span className="text-[var(--text-muted)]">(optional)</span>
        </label>
        <textarea
          id={`${formId}-note`}
          name="note"
          rows={4}
          className="input"
          placeholder="Student count, batches, anything that changes what you need."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-invalid={errorFor("note") ? true : undefined}
          aria-describedby={describedBy("note")}
        />
        {errorFor("note") ? (
          <p className="field-error" id={`${formId}-note-error`}>
            {errorFor("note")}
          </p>
        ) : (
          <p className="field-hint">Up to 1000 characters. Nothing is charged on this page.</p>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={state === "sending"}
          aria-busy={state === "sending"}
        >
          {state === "sending" ? "Sending your request" : "Send access request"}
        </button>
        <p className="text-sm text-[var(--text-muted)]">
          No card, no payment, no automatic renewal.
        </p>
      </div>
    </form>
  );
}