import { twMerge } from "tailwind-merge";

/**
 * The argument shapes `cn` receives, verified per call site rather than assumed:
 *
 *  · string literal, or a string another helper returned (`buttonVariants(...)`,
 *    `scale.box`, `glassStyles[variant]`) — 39 sites.
 *  · `cond && "class"`, which is `false` when the condition is off — 12 sites.
 *  · an optional `className` prop, i.e. `undefined` — throughout.
 *  · a FUNCTION, once: `checkbox.tsx` forwards `@base-ui/react`'s
 *    `className?: string | ((state: CheckboxRootState) => string | undefined)`.
 *    This is why the union below is exhaustive rather than convenient — it is
 *    the one argument shape an audit-only sweep would have silently broken.
 *  · NOT present, anywhere: object literals (`{ active: true }`) and arrays
 *    (`["a", "b"]`). `rg -U "cn\(\s*[\{\[]"` over apps/web/src returns 0 hits,
 *    which is the proof that clsx's recursive flattening had nothing to flatten.
 */
export type ClassArg = string | false | null | undefined | ((...args: never[]) => unknown);

/**
 * PRECISION VERDICT — `clsx` removed, native string handling in its place.
 *
 * Native does what the module did for every shape actually in use: join the
 * truthy string fragments with a single space and drop `false`/`null`/
 * `undefined`/empty strings. Two shapes needed explicit handling rather than
 * naive `filter(Boolean)`, because clsx handled them by ACCIDENT and native
 * would not:
 *   · a function argument — clsx's `toVal` only branches on
 *     `string | number | object`, so `typeof fn === "function"` fell through
 *     every branch and contributed the empty string. `join(" ")` would instead
 *     stringify the function source into the class attribute. The explicit
 *     `typeof === "string"` test reproduces the old behaviour exactly: the
 *     base-ui callback still applies nothing.
 *   · a number argument — none exist today, but `clsx(0)` yields "" while
 *     `filter(Boolean)` drops 0 as well; both agree, so no branch is needed.
 *
 * Equivalent because no call site passes the recursive forms — the one capability
 * clsx has that native cannot express — which the audit above establishes rather
 * than presumes. `twMerge` stays and still owns the conflict-resolution pass
 * that native cannot do.
 */
export function cn(...inputs: ClassArg[]): string {
  const classes = inputs
    .filter((input): input is string => typeof input === "string")
    .filter((input) => input.length > 0)
    .join(" ");
  return twMerge(classes);
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}