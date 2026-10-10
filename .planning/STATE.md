---
status: planning
current_phase: 1
progress:
  total_phases: 6
  percent: 0
next_action: /gsd-plan-phase 1
last_updated: 2026-10-10
---

# Project State — Buddysaradhi

## Current Position

| Field | Value |
|---|---|
| Situation | Initialized · no phase in flight |
| Roadmap | 6 phases · 11/11 requirements mapped |
| Next | `/gsd-plan-phase 1` |
| In-Flight platform | **WEB** — and only WEB (`AGENTS.md` §9.3) |

## Where this project came from

This is a **brownfield** initialization. GSD was layered onto an existing,
substantial product rather than started from an idea:

- The shipped repo is a working Next.js 16 web app, a Deno edge gateway, a shared
  `packages/core` ledger engine, and a Turso/libSQL per-tenant data layer.
- The specification is **already written and ratified**: 27 numbered documents at the
  repo root carrying 132 `BR-*` business rules, 13 `EC-*` edge-case families, 11
  non-negotiable engineering rules and 12 stop-and-ask triggers.

Consequently the new-project questioning phase was **answered by the corpus, not by
the user**. Asking "what do you want to build?" would have risked producing a
parallel description that contradicts the ratified one.

### The integration contract

`.planning/` is an **index over** the spec corpus, never a replacement for it:

| Concern | Canonical home | GSD's role |
|---|---|---|
| What the product *is* | `00_`–`23_*.md` | Never restate it |
| Engineering rules | `AGENTS.md` §2/§3/§8/§9 | Never restate it |
| Business rules | `12_Business_Rules.md` | Trace to them |
| Edge cases | `14_Edge_Cases.md` | Trace to them |
| Sequencing | `.planning/ROADMAP.md` | GSD's job |
| Per-phase work | `.planning/phases/NN-*/` | GSD's job |

**The corpus always wins.** Every requirement in `REQUIREMENTS.md` carries a
`## Spec:` anchor; a requirement without one is orphan code (`AGENTS.md` §0.2) and
gets deleted. `plan_review.source_grounding` is enabled so a plan that cannot cite
the corpus does not ship.

**All 27 spec paths cited across `.planning/*.md` were verified to exist at
generation time.**

## Protected files

`AGENTS.md` is this runtime's **project instruction file** — `--runtime kilo`
resolves to it. It is 133,707 characters of ratified constitution.

GSD's `generate-claude-md` was verified empirically to **skip** an existing
hand-crafted file rather than overwrite it (probe: sentinel text survived, no GSD
markers written). **Never pass `--force` against it.** Changing it is `AGENTS.md`
§8 trigger #6 — 2 reviewers plus orchestrator sign-off.

## Gate flags

Three phases are blocked on human decisions and must not be executed unilaterally:

| Phase | Gate |
|---|---|
| 1 — Spec & documentation integrity | `AGENTS.md` §8 trigger #6 (edits `AGENTS.md`) |
| 3 — Cryptographic key separation | `AGENTS.md` §8 trigger #4 (crypto envelope) — 2 reviewers incl. security owner |
| 4 — Access control & tenant isolation | `AGENTS.md` §8 trigger #1 — RFC 009/010 ratification |

Phases 2, 5 and 6 carry no §8 gate.

One-way doors (batched evidence would make changes unrecoverable):

- **Phase 3** — changing key derivation without a migration makes existing backups
  undecryptable.
- **Phase 4** — deleting the shared-DB fallback strands tenants provisioned that way;
  changing the admin model invalidates live sessions.

## Accumulated Context

### Roadmap Evolution

- 2026-10-10: Initialized from a brownfield audit. 11 requirements captured, 6
  phases derived. Phase 1 ordered first because the three duplicate spec numbers
  block the three deferred specs.

### Pre-existing findings resolved during setup

Not roadmap items — closed before the roadmap existed, recorded so they are not
re-litigated:

| Shipped | Commit |
|---|---|
| Auth bypass + cross-tenant isolation closed | `2eb97a2` |
| Payment breakdown made true; WCAG AA contrast fixed across 19 sites | `745bb80` |
| PR reviewer moved off `pull_request_target` | `257285f` |

### Known open, not yet owned by a phase

- `report-svc` sits outside the WEB In-Flight boundary (`AGENTS.md` §9.3). Phase 5
  touches it, which needs an RFC rather than an edit.
- The Turso credential rotation (SEC-TOKEN-02) is a **provider-side action only the
  owner can perform**. Phase 2 tracks it but cannot complete it alone.

## Blockers

*(empty — none currently open)*

Phase 1 has no dependency, and its `AGENTS.md` §8 gate is a sign-off at
*execution* time, not a precondition for planning it. The reassurance lives here
rather than as prose in this section because GSD's own parser scrapes this heading
for blocker entries, and an earlier sentence beginning "None blocking …" was read
back as a genuine blocker — a self-inflicted phantom. Keep this section free of
sentences that could be mistaken for a blocker line.

---
*Last updated: 2026-10-10 after initialization from brownfield audit*