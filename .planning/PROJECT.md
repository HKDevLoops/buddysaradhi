# Buddysaradhi — GSD Project Context

> **This file is an INDEX, not a specification.** The ratified specification for
> this project already exists and is canonical: `AGENTS.md` (the operating manual
> and constitution) plus the numbered spec corpus `00_Vision.md` … `23_*.md` at the
> repository root. GSD was layered on top to *plan and sequence work against those
> documents*, not to restate them. Where this file and the spec corpus disagree,
> **the spec corpus wins** (AGENTS.md: "the spec is the contract"). Nothing here
> may be cited as authority for a product or engineering decision — cite the spec
> section instead.

## Core Value

A single tutor — or a 200-student coaching institute — runs their entire tuition
business from five screens, offline-first, with the data density of a finance tool
and no server administration. Source: `00_Vision.md`, `01_Product_Principles.md`
P1–P15.

The ONE thing that must work: **a tutor's ledger is always correct.** Every fee,
payment, discount, refund and void is an immutable row; corrections are reversing
rows. A single wrong figure is a livelihood problem for the person who reads it.
Source: `AGENTS.md` §2 Rule 1, `12_Business_Rules.md` BR-LED-01..06,
`10_Security.md` §9.

## What This Is

- **Five persistent screens** — Dashboard, Students, Attendance, Fees & Payments,
  Settings — each a real SSR route (`/dashboard`, `/students`, `/attendance`,
  `/fees`, `/settings`). A sixth requires a ratified principle amendment.
  Source: `AGENTS.md` §2 Rule 4, `13_UI_Guidelines.md`.
- **Single-tenant SQLite per tutor** (Turso/libSQL). `tenant_id` is
  defence-in-depth, not the partitioning key. Source: `11_Data_Model.md` §1.
- **Offline-first.** Every mutation writes locally, then appends to `sync_outbox`
  in the same transaction. Source: `01_Product_Principles.md` P5, BR-SYN-01..04.
- **Integer paise, never float.** Source: `AGENTS.md` §2 Rule 6, BR-M-01.
- **Immutable ledger.** No UPDATE, no DELETE, ever. Source: `AGENTS.md` §2 Rule 1.
- **No telemetry, ever** — not even anonymous. Source: `AGENTS.md` §2 Rule 3,
  `10_Security.md` §17.
- **One edge gateway** on Cloudflare-style workers + Durable Objects; all three
  platforms (web/mobile/desktop) call it over one SDK. Source:
  `17_API_Gateway_System.md`, `deployment/06_Edge_Function_Hosting.md`.

## Stack (from `docs/stack/` + the corpus — verify before relying on it)

| Layer | Technology | Canonical source |
|---|---|---|
| Web | Next.js 16 App Router, TS strict, Tailwind 4 | `AGENTS.md` §3.1 |
| Gateway | Deno 2 edge functions (REST + GraphQL) | `AGENTS.md` §3.2 |
| DB | Turso/libSQL per tutor; Prisma v6.16 on edge | `11_Data_Model.md` |
| Auth | Supabase Auth, RS256 signing keys, JWKS | `10_Security.md` §3 |
| Platform state | **WEB is the only In-Flight platform** | `AGENTS.md` §9.3, `16_Platform_Delivery_Sequence.md` |
| Tests | Vitest (unit/integration), Playwright (E2E), axe (a11y) | `21_Automation_Testing.md` |

## Constraints (non-negotiable — `AGENTS.md` §2)

Eleven rules bind every change. The ones that most often decide a plan:

1. **Ledger append-only** — voids are new rows with `reverses_entry_id`.
2. **No network calls that process user data** — only the v2 blob store.
3. **No telemetry/analytics SDK.**
4. **Five screens only** — a sixth needs a ratified amendment.
5. **Colour from the generated palette or it does not ship.**
6. **Integer paise, never float.**
7. **Every mutation writes `sync_outbox` + `audit_log` in the same transaction.**
8. **Backups are AES-256-GCM + Argon2id, never plaintext.**
9. **No silent failures** — typed errors only.
10. **WCAG 2.1 AA is not optional.**
11. **One directory, one deployment target.**

## How GSD relates to the spec corpus

This is the integration contract, and it is the reason GSD was added at all.

| Concern | Canonical home | GSD's role |
|---|---|---|
| What the product *is* | `00_`–`23_*.md` | **Never restate it.** |
| Engineering rules | `AGENTS.md` §2, §3, §8, §9 | **Never restate it.** |
| Business rules | `12_Business_Rules.md` (132 `BR-*` ids) | **Trace to them.** |
| Edge cases | `14_Edge_Cases.md` (13 `EC-*` families) | **Trace to them.** |
| Sequencing | `.planning/ROADMAP.md` | GSD's actual job |
| Per-phase work | `.planning/phases/NN-*/` | GSD's actual job |
| Verification evidence | `.planning/phases/NN-*/VERIFICATION.md` | GSD's actual job |

**Rules for any plan produced under this project:**

1. Every requirement in `REQUIREMENTS.md` carries a `## Spec` line naming a real
   `BR-*`, `EC-*`, `P*` or `AGENTS.md` section. A requirement with no spec anchor
   is orphan code and must be deleted (`AGENTS.md` §0.2).
2. `plan_review.source_grounding` is **on**. A plan that cannot cite the corpus
   does not ship.
3. `.planning/` never overrides the corpus. It sequences work *against* it.
4. `AGENTS.md` is **protected**. It is the project instruction file for this
   runtime, so GSD's generator was verified to *skip* an existing hand-crafted file
   rather than overwrite it. Do not pass `--force` against it.

## Requirements

### Validated

Already shipped and provable in the repo:

- ✓ Five SSR screens with client chrome — `AGENTS.md` §3.1
- ✓ Per-tenant libSQL + gateway tenant scoping — `11_Data_Model.md`, `17_API_Gateway_System.md`
- ✓ Immutable ledger with SQLite triggers — `10_Security.md` §9, BR-LED-01
- ✓ AES-256-GCM + Argon2id backup envelope — `09_Backup_and_Import_Export.md` §11
- ✓ Receipt numbering monotonic, gaps intentional — BR-RC-01

### Active

Tracked in `.planning/REQUIREMENTS.md`. These are the open obligations as of
initialisation — real findings, each with a spec anchor.

### Out of Scope

- **A sixth screen** — requires a ratified principle amendment (`AGENTS.md` §2 Rule 4).
- **Mobile and desktop implementation** — `AGENTS.md` §9.3 locks both behind the
  signed `WEB-PROD-GATE`. One platform is In-Flight at a time.
- **Telemetry of any kind** — `AGENTS.md` §2 Rule 3, `10_Security.md` §17.
- **RFC 009 / RFC 010 implementation** — written, **deliberately not ratified**.
  See `.planning/REQUIREMENTS.md` for why this is parked rather than done.

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| GSD layered ON TOP of the spec corpus, not merged into it | `AGENTS.md` §0: one canonical home per fact. A parallel `.planning/` spec would be a second source of truth and `22_Redundancy_Audit.md` exists specifically to prevent that. | — Accepted |
| `workflow.research = false` | The domain research is already done and **ratified**: 27 numbered spec files with 132 `BR-*` rules and 13 `EC-*` families. Spawning generic domain researchers would duplicate ratified content and risk contradicting it. | — Accepted |
| `parallelization = false` | `AGENTS.md` §9.2.1 permits exactly **one** in-flight task; builds also share `apps/web/.next`, so parallel builds corrupt each other. | — Accepted |
| `plan_review.source_grounding = true` | The single setting that makes GSD *follow the specs* instead of drifting from them. | — Accepted |
| `model_profile = inherit` | Non-Claude runtime; a tier alias would not resolve. | — Accepted |
| `AGENTS.md` left untouched by the instruction-file generator | Verified empirically: the generator **skipped** a hand-crafted target rather than overwriting it. Passing `--force` would destroy 133 KB of ratified constitution. | — Accepted |
| Payment breakdown reduced to three buckets | `noDues` was a subset of `paid`, so the card summed to more than the roster (3 students rendered as 5). Owner decision. | Shipped `745bb80` |
| `reviewer.yml` moved off `pull_request_target` | It was the only one of eleven workflows using the base-repo-secret trigger. | Shipped `257285f` |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. **Re-check the spec-corpus contract above.** If a phase caused the corpus and
   `.planning/` to disagree, the corpus wins and the roadmap is corrected.

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-10 after initialization — GSD initialised as an index over the existing spec corpus*
