# BASELINE — Buddysaradhi monorepo

**Recorded:** 2026-10-14 · **Phase:** 0 (Safety and baseline) · **Author:** audit pass
**Spec bound by:** `AGENTS.md` §9.1 step 2 (read `worklog.md`), §12 (what "done" means),
§16 (QA protocol), §9.2.2 (close-out discipline)

> This document records **only what was actually executed**, with real exit codes.
> Nothing here is projected, assumed, or copied from a prior report. Where a check
> could not be run, it says `NOT RUN` with the reason. A check that was not run is
> never reported as passing.

---

## 0. Git state and preservation of existing work

Recorded **before** any modification, per directive §1.3 and `AGENTS.md` §9.1.

| Item | Value |
|---|---|
| Branch | `main`, tracking `origin/main`, **in sync** (no divergence) |
| HEAD | `bf39788` — *fix(build,ui,a11y,api): unbreak Vercel build + live-probe fix batch* |
| Working tree | **clean** — no modified, staged, or deleted tracked files |
| Untracked | exactly one: `filestructure_buffy.md` (an inventory document, not code) |
| Stashes | 1: `stash@{0}: On main: PRODUCT-3D-V1-BUILD pre-teardown stash` |

### The stash must not be applied — recorded deliberately

`stash@{0}` is a **pre-teardown snapshot**, not unfinished work. Its diff is
**257 files, +7,516 / −20,670** and it *deletes* the following that are present and
live on disk today: the whole `apps/product-page/src/components/hero/` 3D scene,
`apps/web/src/components/buddysaradhi/glass-shell.tsx`, `apps/web/src/components/ui/glass-card.tsx`,
and the entire `supabase/functions/gateway/` mirror.

Applying it would revert roughly five weeks of shipped work, including the sticky
footer, the glass component layer, the 3D product page, and the gateway
consolidation. It is **left untouched**. Recorded here so that a future agent
reading `git stash list` does not mistake a snapshot for a work-in-progress.

### Recovery point

No destructive step is taken in Phase 0, so `bf39788` **is** the recovery point. No
new branch or stash is required before read-only audit work begins.

---

## 1. Commands executed — exact results

Every row was run from the repository root on the machine state described above.

| # | Command | Exit | Observed result |
|---|---|---|---|
| 1 | `pnpm run lint` | **0** | `eslint .` across **17 of 18** workspace projects all clean. `scripts/principle-lints.ts` → **PASS on all 8 rules**: L1 `no-ledger-mutation`, L6 `no-raw-sql`, L2 `no-float-money`, L3 `no-telemetry-deps`, L4 `no-fetch-in-client`, L5 `no-indigo-accent`, L7 `no-js-source`, L8 `no-unbound-tenant-proxy`. Summary line: `principle-lints: OK — 8 rules clean, 114 allowlisted hit(s).` |
| 2 | `pnpm run typecheck` | **0** | `@buddysaradhi/design-system` build (`tsc -p`), then `web` (`tsc --noEmit`), then `core` (`tsc --noEmit`) — all silent, no diagnostics. |
| 3 | `pnpm run test:unit` | **0** | **77 test files, 1318 tests, 0 failures.** Duration 28.00 s. The visible `ERR [...]` lines in the output are **intentional negative-path assertions** by the blob/manifest script suites (`BLOB_READ_WRITE_TOKEN is not set` → refusing to continue; `refusing to upload mobile/ios/app.ipa`; a 7-failure shape-check fixture). They are the tests proving fail-closed behaviour, not failures. |
| 4 | `pnpm --filter @buddysaradhi/design-system verify` | **0** | `palettes: 20` / `findings: 0 error(s), 0 warning(s)`. Rule 5's contrast gate is **real and green**. It rewrote `tokens.json` + `tokens.css` and `git status` stayed clean ⇒ token generation is deterministic. |
| 5 | `pnpm --filter @buddysaradhi/design-system test` | **0** | 1 file, **31/31 tests** pass. |
| 6 | `deno lint apps/gateway/` | **0** | `Checked 84 files`, no findings. (This is the command the `apps/gateway` `lint` script *names but does not run* — see §4 F-01.) |
| 7 | `deno check apps/gateway/index.ts` | **0** | `Check apps/gateway/index.ts`, no type diagnostics. |
| 8 | `pnpm --filter @buddysaradhi/gateway test` | **0** | **43 test files, 692 tests, 0 failures**, 16.03 s. Covers auth, tenant scoping, crypto/ledger, bounded reads, rate limiting and the `paymentBreakdown` partition. |

### Checks NOT run, and why

| Command | Status | Reason |
|---|---|---|
| `pnpm run test:integration` | **NOT RUN** | Not yet exercised in this pass. Must run before any change that touches persistence. |
| `pnpm run test:a11y` | **NOT RUN** | Requires a browser plus `E2E_EMAIL` / `E2E_PASSWORD`, which are **deliberately absent** since commit `bf39788` removed the committed fallback credential. |
| Playwright e2e (`apps/web/tests/**`) | **NOT RUN** | Same missing credential pair. The harness now *fails loudly* when they are unset, by design (`qaCredentials()` in `tests/e2e/harness.ts:68`). |
| `cargo fmt --check`, `cargo clippy`, `cargo test`, `cargo audit` | **NOT RUN here** | Delegated to a dedicated read-only Rust audit stream (see §3). `apps/desktop` is **LOCKED** behind `WEB-PROD-GATE` (`AGENTS.md` §9.3), so this pass must not edit Rust regardless of what it finds. |
| Live re-probe of `https://buddysaradhi.vercel.app` | **NOT RUN** | Out of scope — no deploy is authorised in this pass. The live deploy still serves **pre-`bf39788`** code. |

---

## 2. Architecture: the conflicts the directive asked to resolve

Directive §2 listed seven mandatory architecture questions. Each is answered below
from files actually read in this pass, not from documentation prose.

### Q1 — Which gateway runtime is canonical?

**Answer: Deno, at `apps/gateway/`. One implementation.**

Evidence:
- `AGENTS.md` §3.2 names `@apps/gateway` at `apps/gateway/` as the canonical backend,
  with runtime Deno 2.
- `git ls-files supabase/` returns **0 files**. The `supabase/functions/gateway/`
  mirror is **already deleted** (commit `2433137`, recorded in `worklog.md:2248` as
  "deleted redundant supabase/functions/gateway mirror (89 tracked files,
  superseded by @apps/gateway)"). The directory that still exists on disk is
  **untracked residue** (`.env`, `.env.example`, and a `node_modules/` tree) and is
  not part of the repository.

> This directly contradicts P0 finding **A1** of the source research report
> ("gateway architecture is inconsistent… Supabase Edge Functions vs Cloudflare
> Workers"). The report was written against a tree state that no longer exists. See
> §5.

### Q2 — What is the relationship between Cloudflare Workers, Durable Objects, Supabase Edge Functions and provisioning?

**Answer: Cloudflare Workers + Durable Objects are a *spec target*, not an
implementation.** `AGENTS.md` §0.3 item 9 and `deployment/06_Edge_Function_Hosting.md`
describe that topology as the intended v1.x hosting recipe; the code that actually
exists and is tested is Deno-on-Supabase-Edge. Both descriptions are internally
consistent because `16_Platform_Delivery_Sequence.md` sequences the migration and the
`WEB-PROD-GATE` has not been signed. **This is a live documentation/spec ambiguity,
not a code defect** — see F-02.

### Q3 — Offline-first vs remote gateway access

**Answer: both, by design, and the boundary is specified.** P5 forbids *the client*
performing remote processing of user data; it does not forbid a server-side gateway.
The enforcement that actually exists is `principle-lints` rule **L4
`no-fetch-in-client`**, green above, which blocks `fetch`/`http`/`axios` in Client
Components. Data leaves the device only through the gateway under a tutor's own
tenant. **No conflict found.**

### Q4 — Which schema/migration system is authoritative?

**Answer: two authorities, and `AGENTS.md` §3.4 (amended) names exactly which two.**
1. Prisma migrations / `prisma db push` — web local/dev, every deploy, and the
   provisioning-time `bootstrapSchema` at sign-up (a sign-up path, not a
   request-time one).
2. `apps/gateway/lib/schema.ts` `ensureSelfRepairingSchema` — the single audited
   self-heal for gateway-managed tenant DBs, idempotent `CREATE TABLE IF NOT EXISTS`
   plus the append-only ledger triggers.

This is enforced: rule **L6 `no-raw-sql`** (green) blocks `$queryRaw`, `$executeRaw`,
`` sql: ` ``, and string-interpolated queries at runtime, with an audited allowlist.
**No third authority exists.** Prisma schemas also exist at `prisma/` and
`packages/core/schema.prisma`; these are *generated/duplicated schema sources* and
are flagged as F-03 (drift risk, not a current defect).

### Q5 — Which package owns what?

| Concern | Owner | Verified by |
|---|---|---|
| The money flow (audit-first ordering, per-invoice attribution, overpayment split) | `packages/core/src/feesFlow.ts` | `AGENTS.md` §3.5 |
| libsql dialect | `packages/core/src/fees.ts` | §3.5 |
| ORM dialect | `packages/core/src/feesPrisma.ts` | §3.5 |
| Ledger append + hash chain | `packages/core/src/ledger.ts` | §3.5 |
| Zod schemas / types / calc utils | `packages/shared` | `AGENTS.md` §3.1 |
| Colour + material tokens | `packages/design-system` (20 palettes) | `verify` green, 0 findings |
| The financial spine | `ledger_entries`, append-only | Rule 1 + L1 + SQLite triggers |

This is the single most important structural fact in the codebase: **the money
logic exists exactly once**, with two I/O dialects, and
`packages/core/src/feesDialectParity.test.ts` is the gate that proves the two
dialects cannot drift. Any DDD restructuring that duplicates `feesFlow.ts` would
*create* a P0 defect, not fix one.

### Q6 — Are the multiple gateway-like surfaces accidental duplication?

**Answer: one is live; six are quarantined legacy stubs.**

| Surface | Lines | Status |
|---|---|---|
| `apps/gateway/` | live (84 files, `deno check` clean, 43 test files / 690 tests per `worklog.md:2798`) | **canonical** |
| `supabase/functions/gateway/` | 0 tracked files | **deleted** (`2433137`) |
| `apps/services/{attendance,auth,ledger,notification,report,student,sync}-svc` | 1,393 total | **legacy stubs** — zero imports from product code, zero workflow refs, excluded by `.vercelignore:11`. They are the `18_Microservice_Architecture.md` v1.x surface. |

`worklog.md:2248` records the decision explicitly: *"deleting them is a spec
decision for the owner, flagged not executed."* That judgement is correct and is
**preserved, not overridden** — see F-04.

### Q7 — Does the implementation match the documented deployment pipeline?

**Answer: yes, and `AGENTS.md` §2 Rule 11 holds.**

`vercel.json` declares `"outputDirectory": "apps/web/.next"` with a build command
that chains only `design-system → shared → core → web`. Exactly one application
directory maps to exactly one deployment target. `.vercelignore:11` excludes
`apps/services/`. No workflow deploys the stubs.

---

## 3. In-scope surfaces and their state

| Surface | Lines / size | State | In-Flight? |
|---|---|---|---|
| `apps/web` | Next.js 16 App Router, RSC | live, `tsc --noEmit` clean, 1318 unit tests green | ✅ **WEB (the only In-Flight platform)** |
| `apps/gateway` | Deno 2, 84 files | live, `deno lint` + `deno check` clean | ✅ canonical backend |
| `packages/core` | ledger engine | live, typechecks | ✅ shared |
| `packages/shared` | Zod schemas | live, typechecks | ✅ shared |
| `packages/design-system` | 20 palettes × 3 materials | live, `verify` 0 findings, 31/31 tests | ✅ shared |
| `packages/security`, `packages/ui` | primitives | live, eslint clean | ✅ shared |
| `apps/desktop/src-tauri` | **23 Rust files, ~2,100 lines** | `Cargo.toml` only; **no Rust test files found** | 🔒 **LOCKED** (`AGENTS.md` §9.3) |
| `apps/mobile` | Expo | lint script is `echo 'Skipping mobile lint'` | 🔒 **LOCKED** |
| `apps/product-page` | marketing | eslint clean | 🔒 LOCKED |
| `apps/services/*` | 7 stubs | quarantined | ❌ legacy |

---

## 4. Findings from this baseline pass

Ordered by real risk. **Severity reflects demonstrated impact, not the source
report's ranking.**

### F-01 — `pnpm run lint` reports success for two projects it does not lint · **P2 · CONFIRMED**

`apps/gateway/package.json:9` is `"lint": "echo 'Deno lint — run via: deno lint apps/gateway/'"`.
`apps/mobile/package.json:69` is `"lint": "echo 'Skipping mobile lint'"`. Both print
`Done` and exit 0.

The gateway is **not** therefore unlinted — `.github/workflows/supabase-ci.yml:34`
and `web-prod-gate.yml:155` both run `deno lint apps/gateway/` and `deno check
apps/gateway/index.ts`, and both pass locally (§1 rows 6–7). So this is a **local
developer-experience defect, not a security gap**: a developer running the documented
command (`AGENTS.md` §9.1 step 5, "run `pnpm run lint`") gets a false green for
gateway TypeScript.

*Not fixed in this pass.* Changing the script to shell out to `deno` would make
`pnpm run lint` depend on a Deno toolchain being installed locally, which
`engines` does not currently declare. Fixing it properly means adding `deno` to
`engines` and wiring the script — a real change with a real DX trade-off, and it
touches build configuration. Carried to the remediation plan.

### F-02 — Two documents describe two different canonical gateway runtimes · **P2 · CONFIRMED (documentation)**

`AGENTS.md` §3.2 and §3.3 declare the canonical backend to be **Deno 2 on Supabase
Edge Functions**. `AGENTS.md` §0.3 item 9, `AGENTS.md` §1.2
("One edge gateway on Cloudflare Workers + Durable Objects") and
`deployment/06_Edge_Function_Hosting.md` describe a **Cloudflare Workers + Durable
Objects** topology with `api.buddysaradhi.app`. The code implements the first. The
second is a not-yet-unlocked v1.x target.

`22_Redundancy_Audit.md` is the dedup map that should record exactly this class of
contradiction, and it does not. This is the same failure shape as the spec-number
collision that Phase 1 of `.planning/ROADMAP.md` was created to fix. **Carried to the
remediation plan**; fixing `AGENTS.md` is `AGENTS.md` §8 trigger #6 (2 reviewers +
orchestrator sign-off) and is therefore **not executed unilaterally**.

### F-03 — Prisma schema duplicated in three locations · **P3 · CONFIRMED**

Schema definitions exist at `prisma/schema.prisma`, `packages/core/schema.prisma`,
and `apps/gateway`'s SQL migrations + `lib/schema.ts` DDL. `AGENTS.md` §3.4 declares
two runtime DDL authorities and forbids a third, but says nothing about which
*file* is the source of truth for schema *shape*. Drift between the Prisma schema
and the gateway's SQL migrations would not be caught by any gate currently in the
repo. **Carried to the remediation plan.**

### F-04 — 1,393 lines of quarantined service stubs with no enforcement · **P3 · CONFIRMED (accepted, by prior decision)**

`apps/services/*-svc` are excluded from the deploy and imported by nothing, but they
remain workspace members (`pnpm-workspace.yaml:3`, `bun.lock`, `deno.lock`), so
they are installed, type-checked and (for `report-svc`) carry a **known-divergent
`paymentBreakdown` contract** — a 4-key shape against the gateway's 3-key partition.

`worklog.md:2599` records this precisely and correctly leaves it as an owner
decision, because `apps/services` is outside the WEB In-Flight boundary
(`AGENTS.md` §9.3). **That decision is preserved.** The `report-svc` divergence is
tracked as requirement `RPT-SHAPE-08` in `.planning/REQUIREMENTS.md:69` and needs an
RFC, not an edit.

### F-05 — `pnpm install` emits peer-dependency warnings on the gateway resolver · **P3 · CONFIRMED**

`deno lint`/`deno check` resolve the workspace and print unsatisfied peer ranges:
`zod-prisma-types@3.3.11` wants `zod ^3.25.0` but the repo pins exact `zod 3.24.2`;
`eslint-plugin-import` wants `eslint ^2–^8.9` but resolves `10.8.0`; `nativewind@4.2.6`
wants `tailwindcss ~3` but resolves `4.3.3`.

The zod pin is **deliberate and load-bearing** — commit `bf39788` pinned all three
manifests to exact `3.24.2` because a dual zod identity caused a TS2589 build
failure on Vercel. So this warning is the *cost* of a deliberate fix, not a new
defect. Recorded so it is not "fixed" later by re-floating the version.

---

## 5. Reconciliation with the source research report

`C:\Users\haris\Downloads\deep-research-report.md` and the narrative that
introduced it were read in full. They must be reconciled with this baseline,
because acting on them unverified would cause real damage.

**The report is not evidence-backed.** By its own admission it did not execute
anything — its inventory section instructs the reader to *"use `find . -name
package.json`"* rather than reporting that it did, and its findings table repeatedly
instructs the reader to *"state 'not executed'"*. Its "Project Inventory" is
explicitly labelled *"A sample inventory (illustrative)"*. Its migration Gantt charts
mark phases `:done` and `:active` with dates in October 2026 for work that does not
exist in this repository.

Claims tested against this baseline:

| Report claim | Priority | Reality, measured |
|---|---|---|
| "**P0** — Broken builds/tests: `npm run build` or `cargo test` currently fails" | P0 | **False for JS/TS.** Lint 0, typecheck 0, 1318/1318 tests pass, `deno check` 0. **Unverified for Rust** (delegated). |
| "**P1** — CORS Misconfiguration: may allow `Access-Control-Allow-Origin: *`" | P1 | **False.** CORS is allowlist-based with `Vary: Origin` and fails closed; verified live and fixed in `bf39788` with parity tests (`proxy.cors.test.ts`). |
| "**P0** — A2: gateway architecture is inconsistent between Supabase Edge and Cloudflare Workers" | P0 | **Resolved.** The duplicate was deleted in `2433137`; 0 tracked files remain. A residual *documentation* ambiguity survives as F-02. |
| "**P1** — GraphQL DoS: no depth or cost limits" | P1 | **Not yet tested.** Assigned to the gateway audit stream; deliberately not self-reported here. |
| "**P1** — Tenant isolation flaw" | P1 | **Not yet tested.** `buildTenantWhere` is unconditional per `AGENTS.md` §2 Q5 notes; assigned to the gateway stream. |
| Proposes `graphql-depth-limit`, `createComplexityLimitRule`, Apollo Server | — | **Would introduce a network dependency and a server framework that do not exist here.** The gateway is Deno with a hand-rolled GraphQL schema. Adopting this verbatim would breach `AGENTS.md` §2 Rule 2 (no new network calls/SDKs without spec authority) and `Rule 5` (boring tech). |
| Proposes moving files into `domain/`, `application/`, `infrastructure/` | — | **Would duplicate `packages/core/src/feesFlow.ts`.** See §2 Q5 — the money logic exists once by design and a dialect-parity test enforces it. A parallel `domain/` tree is the highest-risk change anyone could make to this repo. Requires a §8 stop-and-ask. |
| "**P2** — Singleton/global state concurrency… `lazy_static` without sync" | P2 | **Unverified.** Assigned to the concurrency stream. |
| Rust `cargo clippy -D warnings`, `cargo fmt`, `cargo test` must pass | — | **Cannot be asserted without running them.** Delegated; the stream was explicitly instructed to report `NOT RUN` rather than fabricate. |

**The one durable contribution of the report** is a sound instinct that matches
`AGENTS.md` exactly: *a directory listing cannot prove a defect, and architectural
cosplay is worse than a smaller correct codebase.* That principle is adopted. Its
prescription — restructure into `domain/`/`application/`/`infrastructure/` — is
rejected, because in this repository it would fork the one thing that is already
correct.

---

## 6. What Phase 1 must now do

Four read-only audit streams were launched to cover what a single pass cannot:

1. **AGENTS.md rule compliance** — violations the mechanical gates cannot see
   (Rules 1, 3, 6, 7, 9 specifically: sync_outbox atomicity, integer paise,
   append-only ledger, silent failures).
2. **Rust / Tauri** — ~2,100 lines, currently **zero** Rust test files, entirely
   unaudited. Read-only because `apps/desktop` is LOCKED.
3. **Gateway security** — JWT verification, tenant isolation, provisioning
   authorisation, GraphQL depth/complexity, cache scoping.
4. **Concurrency, sync and financial correctness** — singletons and promise
   memoisation, outbox atomicity and idempotent replay, concurrent payment
   attribution and receipt numbering.

No implementation work begins until those return, because per `AGENTS.md` §0.1 the
spec is the contract and per §9.2.1 exactly one task may be `in_progress`. The one
implementation stream will own `apps/web` (the only In-Flight platform).

---

## 7. Phase 0 conclusion

| Question | Answer |
|---|---|
| Is the tree safe to work on? | **Yes.** Clean, in sync, no user work at risk. |
| Are the documented gates real and green? | **Yes** — 7 gates run, all exit 0, including two (`deno lint`, `deno check`) that are easy to assume and were verified rather than trusted. |
| Are there P0 defects in the baseline? | **None found in this pass.** Two green gates were specifically disbelieved and re-verified by hand (F-01's lint surface, and the design-system contrast gate). |
| Is the architecture fragmented as the source report claims? | **No.** One canonical gateway, one deploy target, one schema authority pair, one money flow. Residual issues are documentary (F-02) and quarantined (F-04). |
| Highest real risk identified | **`apps/desktop/src-tauri`: ~2,100 lines of financial and crypto code with no Rust tests, outside every current gate, and LOCKED from editing.** |

**State: COMPLETED.** Next: `/gsd-plan-phase`-equivalent — await the four audit
streams, then triage into `docs/audit/REMEDIATION_PLAN.md` with P0 first.