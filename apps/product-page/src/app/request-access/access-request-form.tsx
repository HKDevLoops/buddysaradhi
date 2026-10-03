"use client";

// Implements: docs/design/overhaul-plan.md §4.1 (`/request-access`: name, email,
// institute, plan, prepaid billing period, note) + AGENTS.md Rule 10 (44px
// targets, real focus states, errors that name the problem and the recovery).
// Rules live in src/lib/access-request.ts and are shared with the stub endpoint
// at src/app/api/access-request/route.ts, so the browser and the endpoint can
// never disagree about what is valid.

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import {
  BILLING_PERIODS,
  BILLING_PERIOD_LABEL,
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
type FormState = "editing" | "sending" | "sent" | "failed";

const INITIAL_ERRORS: FieldErrors = {};

export function AccessRequestForm() {
  const formId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [plan, setPlan] = useState<PlanId>("institute");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriodId>("annual");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>(INITIAL_ERRORS);
  const [state, setState] = useState<FormState>("editing");
  const [receipt, setReceipt] = useState<AccessRequestReceipt | null>(null);

  // The free plan costs nothing, so it has no prepaid period. The control stays
  // visible and explains itself rather than hiding a field that was asked for.
  const periodApplies = plan !== "free";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setErrors(INITIAL_ERRORS);

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

    try {
      const res = await fetch("/api/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.value),
      });
      const body: unknown = await res.json();
      if (!res.ok || typeof body !== "object" || body === null) {
        throw new Error(`access request rejected with status ${res.status}`);
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
    } catch {
      setErrors({ note: "We could not send your request. Check your connection and try again." });
      setState("failed");
    }
  }

  if (state === "sent" && receipt) {
    const chosen = planDefinition(plan);
    return (
      <div className="panel p-8">
        <h2 className="font-display text-2xl font-bold">Request received.</h2>
        <p className="mt-3 max-w-[62ch] text-pretty text-[var(--text-secondary)]">
          Nothing has been charged. An administrator will reply to{" "}
          <span style={{ color: "var(--text-primary)" }}>{email}</span> to contract the{" "}
          {chosen.name} plan
          {periodApplies && billingPeriod
            ? ` on the ${BILLING_PERIOD_LABEL[billingPeriod].toLowerCase()} period`
            : ""}
          , then provision your access. Your reference is{" "}
          <span style={{ color: "var(--text-primary)" }}>{receipt.reference}</span>.
        </p>
        {receipt.delivery === "stub" && (
          <p className="field-hint">
            This form is currently wired to a stub endpoint, so the request has not yet reached an
            administrator. Delivery is the next piece of work.
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/pricing" className="btn btn-secondary">
            Back to plans
          </Link>
        </div>
      </div>
    );
  }

  const errorFor = (field: AccessRequestField) => errors[field];
  const describedBy = (field: AccessRequestField) =>
    errorFor(field) ? `${formId}-${field}-error` : undefined;

  return (
    <form onSubmit={onSubmit} noValidate className="panel p-6 md:p-8">
      {Object.keys(errors).length > 0 && (
        <p
          role="alert"
          className="mb-6 rounded-panel px-4 py-3 text-sm"
          style={{ background: "var(--surface-inset)", color: "var(--danger)" }}
        >
          {Object.keys(errors).length === 1
            ? "One field needs fixing."
            : `${Object.keys(errors).length} fields need fixing.`}{" "}
          The form has not been sent.
        </p>
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
        <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
          {state === "sending" ? "Sending" : "Send access request"}
        </button>
        <p className="text-sm text-[var(--text-muted)]">
          No card, no payment, no automatic renewal.
        </p>
      </div>
    </form>
  );
}