# 22 — Redundancy Audit & Deduplication Map

> One sentence: this file is the cleanliness contract — it identifies every place the Buddysaradhi planning docs repeat themselves, point to stale references, or carry superseded prose, and prescribes the canonical home for each topic. An agent finding a contradiction between two docs consults this file first to know which one wins.

---

## 0. How to Use This File

- **Before writing a new section in any spec**, check §3 (the dedup map) to see if the topic already has a canonical home. If yes, write a one-line summary + cross-reference; do not re-derive.
- **Before citing a cross-reference**, check §4 (stale references) to ensure the target still exists at the cited section number. The audit caught 8 stale `§N` citations and 1 stale filename in the existing tree.
- **When two docs disagree**, check §5 (precedence) to know which wins. The rule of thumb: the *most specific* doc wins for its scope; the *foundational* doc wins for the statement of principle.
- **Before promoting a paragraph to a table**, check §6 (prose-to-table candidates) — 12 specific locations are pre-identified.
- **Before treating an older section as authoritative**, check §7 (superseded sections) — 9 sections in `00`–`15` are now summary-only, with the canonical content in `16`–`20` or the per-platform subdirs.
- **The lint in §8 is CI-enforced.** A new duplicate H2 heading outside the allowlist fails the build. The dedup edit ticket is §9; **do not execute it from this file** — it is a separate physical-dedup task.

---

## 1. Audit Methodology

This audit was performed in four passes over the 67 markdown files under `/home/z/my-project/buddysaradhi_Planning/` (≈57,711 lines total).

1. **Phrase-grep pass.** For each of the 8 canonical phrases the user named (`Five Screens`, `Immutable Ledger`, `Vibrant Glass`, `Production Gate`, `no-hardcode`/`no-hardcoded-ingress`, `never mock the ledger`, `sticky footer`, `250 students`), the Grep tool was run across the whole tree with `-n` line numbers. Every hit was classified as **definition** (first statement of the rule), **enforcement** (lint/CI/test), **re-statement** (prose repeating the rule), or **citation** (cross-reference). Re-statements outside the canonical home are the redundancy findings in §2.
2. **Pair-comparison pass.** Every pair of files that share a topic was diffed by reading the relevant section in each. The pair list was built from the phrase-grep output. Where the same paragraph appeared in >1 file (notably the ASCII Mockup Suite §20 preamble — verbatim in 13 files), it was flagged.
3. **Cross-reference check pass.** Every pattern matching `§<digit>` and `<digit>+_[A-Z][a-z]+.*\.md` was extracted. Each target was checked against the actual heading list of the target file (via `^## ` grep). Mismatches — wrong section number, wrong filename, dead target — were recorded in §4.
4. **Prose-vs-table pass.** Each spec section that exceeded 8 lines of running prose for content that was intrinsically tabular (a fixed enumeration, a comparison, a state matrix) was flagged for §6.
5. **Superseded-section pass.** For every section in `00`–`15`, the audit asked: "does a newer doc (`16`–`20` or a per-platform subdir) now cover this more authoritatively?" If yes, the section was flagged for §7.

The audit does **not** propose rewrites. It proposes *moves*: each redundancy finding prescribes KEEP-in-canonical-home and REPLACE-elsewhere-with-cross-ref. The execution ticket is §9.

### 1.1 Scope & Exclusions

**In scope:** all 67 `.md` files under `/home/z/my-project/buddysaradhi_Planning/` (top-level `00`–`20` + `AGENTS.md` + the `web/`, `mobile/`, `desktop/`, `deployment/`, `product/` subdirs and their READMEs). Total ≈57,711 lines.

**Out of scope:**
- Code under `apps/`, `packages/`, `prisma/`, `src/` — the audit is doc-only. Code-vs-spec drift is a separate audit.
- `worklog.md` — it is an append-only execution log, not a spec. Its redundancy (repeated close-out checklists, repeated Agent Browser smoke steps) is intentional and governed by `AGENTS.md` §9.2.
- `docs/rfc/` — RFCs are transient by design; they are superseded by the spec amendment they produce.
- The README.md files in each subdir — they are navigation aids, and their restated context (e.g. `mobile/README.md` L59 restating the 5 non-negotiables) is intentional onboarding for an agent landing in that subdir without having read the top-level `AGENTS.md`. They are flagged in §2 only where the restatement exceeds 1 paragraph.

**Caveats:** see §11.

---

## 2. The Redundancy Findings (ranked by severity)

Severity scale: **P0** = contradictory rule that will cause a wrong implementation. **P1** = verbatim duplication that will drift on the next edit. **P2** = restatement that adds maintenance surface but is currently consistent. **P3** = intentional repetition (tagline, glossary) — flagged for awareness only.

**Audit stats at a glance:** 19 findings total — **0 P0** (no contradictions found; the spec is internally consistent), **3 P1** (R1 ASCII preamble, R2 pricing paragraph, R11 anti-pattern rows), **13 P2** (the bulk — re-statements that should become cross-refs), **3 P3** (intentional repetition — R8, R12, R18, R19, allowlist). The P1 set is the dedup priority; the P2 set is the maintenance-surface reduction; the P3 set is informational only.

| # | Redundancy | Files Involved | Sev | Action |
|---|---|---|---|---|
| R1 | The **"Every mockup below follows `13_UI_Guidelines.md §20`…"** preamble is duplicated verbatim (or near-verbatim) in 13 files. Each copy lists the same 6 rules (fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named, glass tiers per §5.5, neumo recipes per §6.6) with only the box-width rule varying. | `mobile/AGENTS.md` L514, `mobile/01_Architecture.md` L530, `mobile/02` L881, `mobile/03` L728, `mobile/04` L648, `mobile/05` L581, `mobile/06` L528, `mobile/07` L616, `mobile/README.md` L153, `deployment/AGENTS.md` L421, `deployment/01` L440, `deployment/02` L560, `deployment/03` L542, `deployment/04` L503, `deployment/05` L1108, `deployment/README.md` L189, `16_*.md` L283, `17_*.md` L280, `18_*.md` L340, `19_*.md` L262 | **P1** | KEEP the preamble in `13_UI_Guidelines.md §20` (canonical). In every other file, REPLACE the 6-bullet preamble with a one-liner: *"Mockups follow `13_UI_Guidelines.md §20`; box widths: 60–80 for X, 80–100 for Y."* |
| R2 | The **"Free for everyone, for now" + 250-student soft-guidance** paragraph is restated at length in 7 files. Each restatement re-explains the model, the §1.6 trigger, the grandfather clause, and the friendly prompt. | `12_Business_Rules.md` BR-PRC-01/02/03 + BR-STU-11 (canonical), `product/05_Pricing_and_Plans.md` §1.2 (canonical), `product/06_FAQ.md` §6.2 (canonical for FAQ), `product/07_CTA_and_Conversion.md` L360 (re-statement), `00_Vision.md` L474 + L388 (re-statement), `15_Future_Roadmap.md` L451 (re-statement), `mobile/AGENTS.md` L495 (re-statement), `mobile/README.md` L121 (re-statement) | **P1** | KEEP `12_Business_Rules.md` BR-PRC-01/02/03 + BR-STU-11 (rule) and `product/05_Pricing_and_Plans.md §1.2` (pricing context). In `00_Vision`, `15_Future_Roadmap`, `mobile/AGENTS`, `mobile/README`, `product/07` — REPLACE the paragraph with: *"Free for everyone, for now (`12_Business_Rules.md` BR-PRC-01, BR-STU-11). 250 students is internal soft guidance, not a cap."* |
| R3 | The **"Vibrant Glass & Neumorphism" + bioluminescent palette** definition is restated in 6+ files with the full hex list. | `13_UI_Guidelines.md` §1 + §2 (canonical), `01_Product_Principles.md` AP-6 (canonical principle), `00_Vision.md` §9.1 (canonical manifesto), `05_Students.md` L5 (re-statement), `AGENTS.md` L60 + L112 (re-statement), `mobile/AGENTS.md` L11 + L267, `desktop/AGENTS.md` L201, `deployment/AGENTS.md` L120, `product/AGENTS.md` L247, `web/README.md` L204, `product/README.md` L290, `desktop/README.md` L128 | **P2** | KEEP `13_UI_Guidelines.md §2` (token system) + `01_Product_Principles.md` AP-6 (principle) + `00_Vision.md` §9.1 (manifesto). In every other file, REPLACE the full hex list with: *"Bioluminescent palette only (AP-6, `13_UI_Guidelines.md §2.1`); no indigo/blue accents."* |
| R4 | The **"Production Gate"** definition (G1–G5 generic + W1–W7 web + M1–M7 mobile + D1–D7 desktop) is restated in 5 files. | `16_Platform_Delivery_Sequence.md` §3 + §4 + §5 + §6 (canonical), `AGENTS.md` §9.2 step 3 (re-statement), `17_API_Gateway_System.md` §11 (re-statement), `18_Microservice_Architecture.md` §1 + L79 + L105 + L320 (re-statement), `19_Concurrency_and_Testing.md` §1 + L246 + L383 (re-statement), `20_3D_Product_Page.md` §1 + L155 + L282 (re-statement), `web/AGENTS.md` L15 + L19 (re-statement), `mobile/AGENTS.md` L15 (re-statement), `desktop/AGENTS.md` L15 (re-statement) | **P2** | KEEP `16_Platform_Delivery_Sequence.md` §3 (generic gate) + §4/§5/§6 (per-platform). In every other file, REPLACE the gate re-statement with: *"Production Gate (G1–G5) per `16_Platform_Delivery_Sequence.md` §3; web gate (W1–W7) per §4."* |
| R5 | The **"no-hardcoded-ingress" / "all clients go through the gateway"** rule is restated in 5 files. | `17_API_Gateway_System.md` §2.2 (canonical), `19_Concurrency_and_Testing.md` L203 + L238 (re-statement), `web/AGENTS.md` L22 (re-statement), `mobile/AGENTS.md` L23 (re-statement), `AGENTS.md` L41 (one-line summary, OK) | **P2** | KEEP `17_API_Gateway_System.md` §2.2 (rule + lint spec). In `19_Concurrency`, `web/AGENTS`, `mobile/AGENTS` — REPLACE with: *"No client may hardcode a service URL (`17_API_Gateway_System.md` §2.2, lint `no-hardcoded-ingress`)."* |
| R6 | The **"never mock the ledger"** rule is defined in `AGENTS.md` §7.3 and re-stated in 3 files. | `AGENTS.md` §7.3 (canonical, with code example), `19_Concurrency_and_Testing.md` §2.2 (canonical specialisation), `mobile/AGENTS.md` L306 (re-statement), `desktop/02_Rust_Core.md` L1032 (re-statement) | **P2** | KEEP `AGENTS.md` §7.3 (rule + good/bad code example) and `19_Concurrency_and_Testing.md` §2.2 (concurrency specialisation). In `mobile/AGENTS` and `desktop/02_Rust_Core` — REPLACE with: *"Never mock the DB in a ledger test (`AGENTS.md` §7.3); use in-memory SQLite."* |
| R7 | The **"sticky footer"** rule is restated in 9 files. | `13_UI_Guidelines.md` §13 (canonical visual contract), `AGENTS.md` §6.3 (canonical web layout enforcement), `web/01_Architecture.md` L250 + L677 (re-statement), `web/07_Landing_Page.md` L746 + L767 (re-statement), `web/AGENTS.md` L199 + L240 + L412 + L446 (re-statement), `mobile/03_Navigation_and_State.md` L183 (mobile variant — KEEP), `deployment/01_Vercel_Hosting.md` L393 + L597 (re-statement), `deployment/05_CI_CD_GitHub_Actions.md` L232 (CI assertion — KEEP), `16_Platform_Delivery_Sequence.md` W1 (gate criterion — KEEP), `desktop/AGENTS.md` L366 + L419 (re-statement) | **P2** | KEEP `13_UI_Guidelines.md §13` + `AGENTS.md` §6.3` (definitions), `mobile/03` L183 (mobile variant), `deployment/05` L232 (CI assertion), `16` W1 (gate). In `web/01`, `web/07`, `web/AGENTS`, `deployment/01`, `desktop/AGENTS` — REPLACE the rule restatement with: *"Sticky footer mandatory (`13_UI_Guidelines.md §13`, `AGENTS.md` §6.3)."* |
| R8 | The **"Five Screens, Forever"** list (Dashboard, Students, Attendance, Fees & Payments, Settings) is enumerated in 12+ files. | `01_Product_Principles.md` P2 (canonical principle), `AGENTS.md` Rule 4 (canonical enforcement), `02_Core_Logic.md` §2 (canonical surface map), `00_Vision.md` §1.1 + L56 + L131 (manifesto), `16_*.md` L128 (re-statement), `mobile/01` L127 + L181 (re-statement), `mobile/README` L59 + L88 (re-statement), `desktop/AGENTS` L42 + L44 (re-statement), `product/01` §9 + L21 + L184 (re-statement), `product/03` §1 + §2.6 (re-statement), `product/06_FAQ` L354 (re-statement), `15_Future_Roadmap` L265 + L273 + L660 + L716 (amendment context — KEEP) | **P3** | KEEP `01_Product_Principles.md` P2 (principle) + `02_Core_Logic.md` §2 (surface map) + `AGENTS.md` Rule 4 (enforcement). The 12 restatements are mostly intentional (per-platform READMEs must list the five). ALLOWLIST — no action; just be aware the list lives canonically in 3 places. |
| R9 | The **"Immutable Ledger"** rule (append-only, voids not edits, `reverses_entry_id`) is restated in 9 files. | `01_Product_Principles.md` P4 (canonical principle), `02_Core_Logic.md` §6 (canonical engine deep dive), `12_Business_Rules.md` §6 BR-LED-01..06 (canonical rule IDs), `10_Security.md` §9 (canonical trigger spec), `AGENTS.md` Rule 1 (canonical enforcement), `00_Vision.md` §11.4 (manifesto), `07_Fees_and_Payments.md` §1 + §6.3 (screen-level), `18_Microservice_Architecture.md` L23 (service spec — KEEP), `product/01` L196 (marketing — KEEP), `web/04_API_Routes.md` L687 (re-statement) | **P2** | KEEP `01_Product_Principles.md` P4 (principle) + `12_Business_Rules.md` §6 BR-LED-* (rule IDs) + `02_Core_Logic.md` §6 (engine) + `10_Security.md` §9 (trigger) + `AGENTS.md` Rule 1 (enforcement). In `00_Vision` §11.4, `07_Fees` §1, `web/04_API_Routes` — REPLACE the rule restatement with: *"Ledger is append-only (P4, BR-LED-01, `02_Core_Logic.md` §6); voids are new rows with `reverses_entry_id`."* |
| R10 | The **"AES-256-GCM + Argon2id backup envelope"** spec (envelope layout, KDF params, no escrow) is restated in 6 files. | `10_Security.md` §15 (canonical deep dive), `09_Backup_and_Import_Export.md` §11 (canonical round-trip test), `AGENTS.md` Rule 8 (canonical enforcement), `15_Future_Roadmap.md` L80 (re-statement), `18_Microservice_Architecture.md` L23 (re-statement), `mobile/02_Native_Modules_and_Storage.md` L1069 (re-statement), `desktop/02_Rust_Core.md` L1006 (re-statement) | **P2** | KEEP `10_Security.md` §15 + `09_Backup` §11 + `AGENTS.md` Rule 8. In `15_Future_Roadmap`, `18_Microservice`, `mobile/02`, `desktop/02` — REPLACE with: *"AES-256-GCM + Argon2id envelope (`10_Security.md` §15, BACKUP-1, `09_Backup_and_Import_Export.md` §11)."* |
| R11 | The **"Anti-Patterns for Agents"** table is duplicated across 5 AGENTS files with overlapping rows. | `AGENTS.md` §10 (canonical, 28 rows), `web/AGENTS.md` §10 (web-specific, ~10 rows), `mobile/AGENTS.md` §8 (mobile-specific), `desktop/AGENTS.md` (desktop-specific), `deployment/AGENTS.md` §8 (release-eng-specific), `product/AGENTS.md` (stop-and-ask variant) | **P1** | KEEP `AGENTS.md` §10 (master list) + per-platform AGENTS files for platform-specific rows only. Each per-platform file should DELETE rows that duplicate the master list and KEEP only the platform-specific ones (e.g. `mobile/AGENTS` keeps "FlatList >20" but should drop "Using indigo because it looks nice"). |
| R12 | The **"Elevator pitch"** — *"Five screens. Seven engines. One ledger. Zero servers to manage."* — appears verbatim in 8 files. | `00_Vision.md` §1.1 + §13 + L524 (canonical first statement), `AGENTS.md` §1.1 (canonical agent-facing), `product/01_Product_Positioning.md` §1 (canonical marketing), `product/06_FAQ.md` L241 (canonical FAQ), `web/07_Landing_Page.md` L292 + L572 + L583 + L599 (canonical page copy), `20_3D_Product_Page.md` L321 (re-statement), `mobile/07_App_Store_Release.md` L113 + L748 (canonical App Store copy), `product/09_SEO_and_Analytics.md` L155 + L253 (canonical SEO) | **P3** | ALLOWLIST — this is the marketing tagline; repetition is the point. No action. |
| R13 | The **"WCAG 2.1 AA (target AAA), 44×44px, prefers-reduced-motion"** triple is restated in 6 files. | `13_UI_Guidelines.md` §10 (canonical), `01_Product_Principles.md` P15 + AP-14 (canonical principle), `AGENTS.md` Rule 10 (canonical enforcement), `03_User_Flows.md` §6 (re-statement), `15_Future_Roadmap.md` v1.2 (re-statement), `deployment/05` L1330 (CI assertion — KEEP), `mobile/03` L728 (re-statement in mockup preamble) | **P2** | KEEP `13_UI_Guidelines.md` §10 + `01_Product_Principles.md` P15 + `AGENTS.md` Rule 10. In `03_User_Flows` §6, `15_Future_Roadmap` v1.2 — REPLACE with: *"WCAG 2.1 AA (target AAA), 44×44 targets, `prefers-reduced-motion` honoured (`13_UI_Guidelines.md` §10, Rule 10)."* |
| R14 | The **"Receipt numbering is monotonic; gaps are intentional"** rule is restated in 4 files. | `12_Business_Rules.md` §12a BR-RC-01 (canonical), `07_Fees_and_Payments.md` §6 (screen-level), `AGENTS.md` anti-pattern rows 16 + 22 (canonical enforcement, but duplicated), `01_Product_Principles.md` P9 (principle) | **P2** | KEEP `12_Business_Rules.md` §12a BR-RC-01 (rule) + `01_Product_Principles.md` P9 (principle). DELETE AGENTS.md anti-pattern row 22 (it duplicates row 16 — both say "reuse forbidden"). |
| R15 | The **"E2E test asserts ≤2 clicks from each of the five screens"** enforcement line is restated in 3 files. | `01_Product_Principles.md` P3 (canonical, but cites `19_Testing_Requirements.md` which doesn't exist — see §4 stale-ref #1), `19_Concurrency_and_Testing.md` §5 (canonical per-platform E2E), `03_User_Flows.md` (re-statement) | **P2** | KEEP `19_Concurrency_and_Testing.md` §5 (per-platform golden-path E2E) + `01_Product_Principles.md` P3 (principle). FIX the stale ref in P3 first (§4 #1). |
| R16 | The **"single-tenant SQLite / 1 user = 1 Turso DB / `tenant_id` is defence-in-depth"** triple is restated in 6+ files. | `00_Vision.md` §10 (canonical manifesto), `10_Security.md` §2 (canonical provisioning) + §7 (canonical RLS), `11_Data_Model.md` §1 (canonical schema), `AGENTS.md` L55 + L210 + L612 (canonical agent-facing), `02_Core_Logic.md` §20 (canonical provisioning flow), `05_Students.md` L543 + L949 (re-statement), `09_Backup` L428 (re-statement), `15_Future_Roadmap.md` (re-statement) | **P2** | KEEP `00_Vision.md` §10 + `10_Security.md` §2+§7 + `11_Data_Model.md` §1 + `AGENTS.md` L55. In `05_Students`, `09_Backup`, `15_Future_Roadmap` — REPLACE with: *"Single-tenant: 1 user = 1 Turso DB; `tenant_id` is defence-in-depth (`10_Security.md` §2, §7)."* |
| R17 | The **"GlassShell is persistent across navigation; only `/` is a user-facing route"** invariant is restated in 5+ files. | `02_Core_Logic.md` §1 (canonical), `AGENTS.md` L199 (re-statement, also has stale §5 ref — see §4 S10), `web/AGENTS.md` L11 (re-statement), `web/README.md` L155 (re-statement), `07_Fees_and_Payments.md` L62 (re-statement, also has stale §5 ref — see §4 S11), `08_Settings.md` L42 (re-statement), `mobile/03_Navigation_and_State.md` L32 (mobile variant — KEEP), `desktop/01_Architecture.md` L40+L117+L174+L206+L208 (desktop variant — KEEP) | **P2** | KEEP `02_Core_Logic.md` §1 (shell spec) + `mobile/03` L32 + `desktop/01` (per-platform variants). In `AGENTS.md` L199, `web/AGENTS` L11, `web/README` L155, `07_Fees` L62, `08_Settings` L42 — REPLACE with: *"Persistent `GlassShell`; only `/` is user-facing (`02_Core_Logic.md` §1)."* Also fix the stale §5 refs per §4. |
| R18 | The **"command palette (⌘K / Ctrl+K) is mandatory on every surface"** rule is restated in 4 files. | `01_Product_Principles.md` P3 (canonical principle), `02_Core_Logic.md` §1 (canonical shell spec, topbar mounts ⌘K), `13_UI_Guidelines.md` §8 (canonical component vocabulary), `web/01_Architecture.md` (re-statement), `desktop/01_Architecture.md` L226 (re-statement), `mobile/03_Navigation_and_State.md` (re-statement) | **P3** | KEEP `01_Product_Principles.md` P3 + `02_Core_Logic.md` §1 + `13_UI_Guidelines.md` §8. The per-platform re-statements are short and platform-specific (Ctrl+K vs ⌘K vs long-press); allowlist. |
| R19 | The **"tutor is the data controller; Buddysaradhi is the processor"** GDPR/DPDP framing is restated in 3 files. | `10_Security.md` §22 (canonical compliance posture), `00_Vision.md` §10 (manifesto), `15_Future_Roadmap.md` (re-statement) | **P3** | KEEP `10_Security.md` §22. The `00_Vision` and `15_Future_Roadmap` mentions are 1-line each and frame different scopes (sovereignty vs v2.0 sync); allowlist. |

### 2.1 Files Most Affected by Redundancy

The leaderboard below shows which files carry the most restatements flagged in §2. The dedup work in §9 should start with the top 5 — they account for ~60% of the total restatement surface.

| Rank | File | P1 hits | P2 hits | P3 hits | Total | Primary redundancy |
|---|---|---|---|---|---|---|
| 1 | `AGENTS.md` (top-level) | R11 (anti-pattern master) | R3, R5, R7, R9, R13, R17 | R12, R18 | 9 | Master list of anti-patterns; restates every principle for agent-facing purposes. By design — but R11 row overlap with per-platform AGENTS files is the actionable item. |
| 2 | `mobile/AGENTS.md` | R1, R2, R11 | R3, R5, R17 | R8, R12 | 8 | Mobile restates web's rules for mobile agents; R1 ASCII preamble + R2 pricing paragraph are the dedup targets. |
| 3 | `00_Vision.md` | R2 | R3, R9, R16, R17 | R12, R19 | 7 | The manifesto restates every principle poetically; R2 + R9 + R16 are the dedup targets (the manifesto should cross-ref, not re-derive). |
| 4 | `15_Future_Roadmap.md` | R2 | R3, R9, R10, R13, R16 | R19 | 7 | The roadmap restates pricing, palette, ledger, backup, WCAG, single-tenant for the v2.x context; all should be one-line cross-refs. |
| 5 | `deployment/AGENTS.md` | R1, R11 | R3, R5, R7 | — | 5 | Release-eng AGENTS restates web's rules; R1 ASCII preamble is the dedup target. |
| 6 | `13_UI_Guidelines.md` | — | R1 (canonical home), R3 (canonical home), R7 (canonical home), R13 (canonical home) | — | 4 | The canonical home for 4 of the 19 findings; not a dedup target, but the file other docs cross-ref into. |
| 7 | `02_Core_Logic.md` | — | R8 (canonical), R9 (canonical), R17 (canonical) | R18 | 4 | The canonical home for engine specs; superseded sections U1, U2, U3, U10 live here. |
| 8 | `12_Business_Rules.md` | R2 (canonical), R14 | R9 (canonical), R16 (canonical) | — | 4 | The canonical home for rule IDs; R14 (duplicate anti-pattern row 22) is the only dedup target. |
| 9 | `web/07_Landing_Page.md` | — | R7, R17 | R12 | 3 | The landing-page implementation spec restates sticky-footer + GlassShell; both should be one-line cross-refs. |
| 10 | `01_Product_Principles.md` | — | R3 (canonical), R9 (canonical), R13 (canonical), R15 (canonical, has stale ref) | R8 (canonical), R18 (canonical) | 6 | The canonical home for principles; R15's stale ref (S1) is the dedup target. |

**Key insight:** `00_Vision.md` and `15_Future_Roadmap.md` are the two files that most need dedup — they are *manifesto* and *roadmap* documents that have accreted operational restatements over time. Their job is to frame the *why* and the *when*, not to re-derive the *what*. The dedup in §9 R2, R3, R9, R10, R13, R16 returns them to that job.

---

## 3. The Deduplication Map (topic → canonical home)

This is the agent's lookup table. **"Where does X live?"** → the first column is the topic, the second is the canonical file + section. Secondary homes (where the topic is also legitimately discussed) are in parentheses.

| # | Topic | Canonical Home (file §section) |
|---|---|---|
| D1 | Five Screens, Forever (P2) | `01_Product_Principles.md` P2 (principle) + `02_Core_Logic.md` §2 (surface map) + `AGENTS.md` Rule 4 (enforcement) |
| D2 | Seven Hidden Engines (list + overview) | `02_Core_Logic.md` §4 (overview) + `00_Vision.md` §1.1 (manifesto) |
| D3 | Engine state machines | `02_Core_Logic.md` §5 |
| D4 | Ledger Engine (append-only, double-entry, hash chain, void semantics) | `02_Core_Logic.md` §6 (engine deep dive) |
| D5 | Ledger business rules (BR-LED-*) | `12_Business_Rules.md` §6 |
| D6 | Ledger trigger / tamper evidence | `10_Security.md` §9 (LEDGER-1..4) |
| D7 | Immutable Ledger principle (P4) | `01_Product_Principles.md` P4 |
| D8 | Ledger enforcement (no update/delete) | `AGENTS.md` Rule 1 + `12_Business_Rules.md` BR-LED-01/L02 |
| D9 | Sync Engine (v1 stub + v2 design) | `02_Core_Logic.md` §9 |
| D10 | Sync conflict resolution (LWW, UUID-keyed ledger) | `12_Business_Rules.md` §9 (BR-SYN-01..04) + `14_Edge_Cases.md` EC-SY-* |
| D11 | Mobile offline sync implementation | `mobile/04_Offline_Sync_and_Conflict_Resolution.md` |
| D12 | v2.0 sync security (E2E envelope, vector clocks) | `10_Security.md` §19 + `15_Future_Roadmap.md` v2.0 |
| D13 | sync_outbox discipline | `12_Business_Rules.md` BR-SYN-01..03 + `AGENTS.md` Rule 7 |
| D14 | Vibrant Glass & Neumorphism (manifesto) | `00_Vision.md` §9.1 |
| D15 | Color token system (bioluminescent palette, no indigo/blue) | `13_UI_Guidelines.md` §2 |
| D16 | No-indigo/blue principle (AP-6) | `01_Product_Principles.md` AP-6 + `AGENTS.md` Rule 5 |
| D17 | Glass panel recipe (3 tiers) | `13_UI_Guidelines.md` §5 |
| D18 | Neumorphic surfaces (raised/inset/pressed) | `13_UI_Guidelines.md` §6 |
| D19 | Sticky footer (visual contract) | `13_UI_Guidelines.md` §13 |
| D20 | Sticky footer (web layout enforcement) | `AGENTS.md` §6.3 |
| D21 | Sticky footer (CI assertion) | `deployment/05_CI_CD_GitHub_Actions.md` L232 |
| D22 | Sticky footer (mobile variant) | `mobile/03_Navigation_and_State.md` L183 |
| D23 | WCAG 2.1 AA accessibility commitments | `13_UI_Guidelines.md` §10 + `01_Product_Principles.md` P15 |
| D24 | Accessibility enforcement (Rule 10) | `AGENTS.md` Rule 10 |
| D25 | Production Gate (generic G1–G5) | `16_Platform_Delivery_Sequence.md` §3 |
| D26 | Web Production Gate (W1–W7) | `16_Platform_Delivery_Sequence.md` §4 |
| D27 | Mobile Production Gate (M1–M7) | `16_Platform_Delivery_Sequence.md` §5 |
| D28 | Desktop Production Gate (D1–D7) | `16_Platform_Delivery_Sequence.md` §6 |
| D29 | One-platform-In-Flight rule | `16_Platform_Delivery_Sequence.md` §1 + `AGENTS.md` §9.2 step 1 |
| D30 | API Gateway (one gateway, contract-first) | `17_API_Gateway_System.md` §2 |
| D31 | no-hardcoded-ingress lint | `17_API_Gateway_System.md` §2.2 |
| D32 | Microservice extraction order | `18_Microservice_Architecture.md` §5 |
| D33 | Concurrency model (event-loop stall, race tests) | `19_Concurrency_and_Testing.md` §1 + §3 |
| D34 | Test coverage floors (per platform, per module) | `19_Concurrency_and_Testing.md` §2.1 |
| D35 | Never-mock-the-ledger rule | `AGENTS.md` §7.3 (rule) + `19_Concurrency_and_Testing.md` §2.2 (concurrency specialisation) |
| D36 | 3D product page hero scene | `20_3D_Product_Page.md` (whole file) |
| D37 | "Free for everyone, for now" pricing model | `product/05_Pricing_and_Plans.md` §1 + §1.6 (context) + `12_Business_Rules.md` BR-PRC-01 (rule) |
| D38 | 250-student soft guidance | `12_Business_Rules.md` BR-STU-11 (rule) + `product/05_Pricing_and_Plans.md` §1.2 (cost math) |
| D39 | Pricing grandfather clause | `12_Business_Rules.md` BR-PRC-02 + `product/05_Pricing_and_Plans.md` §1.6.3 |
| D40 | §1.6 trigger (when paid tiers launch) | `product/05_Pricing_and_Plans.md` §1.6 + `12_Business_Rules.md` BR-PRC-08/10 |
| D41 | Pricing edge cases (EC-PRC-*) | `14_Edge_Cases.md` EC-PRC-01..05 |
| D42 | Backup crypto envelope (AES-256-GCM + Argon2id) | `10_Security.md` §15 |
| D43 | Backup round-trip test | `09_Backup_and_Import_Export.md` §11 |
| D44 | Backup enforcement (Rule 8) | `AGENTS.md` Rule 8 |
| D45 | Integer paise / no-float-money (BR-M-01) | `12_Business_Rules.md` §12c BR-M-01 + `AGENTS.md` Rule 6 |
| D46 | Receipt numbering monotonicity (BR-RC-01) | `12_Business_Rules.md` §12a BR-RC-01 |
| D47 | Sensitive-mutation PIN matrix | `10_Security.md` §4 |
| D48 | App lock (PIN + biometric) | `10_Security.md` §3 |
| D49 | Audit log discipline | `10_Security.md` §8 + `12_Business_Rules.md` BR-SEC-03 |
| D50 | No-telemetry contract (TELE-1) | `10_Security.md` §17 + `AGENTS.md` Rule 3 + `01_Product_Principles.md` AP-10 |
| D51 | Single-tenant SQLite (1 user = 1 Turso DB) | `00_Vision.md` §10 + `10_Security.md` §2 + `11_Data_Model.md` §1 |
| D52 | Provisioning flow (Supabase → Turso) | `02_Core_Logic.md` §20 + `web/03_Auth_and_Provisioning.md` |
| D53 | Data model (Prisma schema, UUID v7, integer paise) | `11_Data_Model.md` (whole file) |
| D54 | Tenant_id defence-in-depth | `11_Data_Model.md` §1 + `10_Security.md` §7 |
| D55 | Five-screen → engine dependency matrix | `02_Core_Logic.md` §23 |
| D56 | ASCII Art Conventions (spec-wide §20) | `13_UI_Guidelines.md` §20 |
| D57 | Anti-patterns for agents (master list) | `AGENTS.md` §10 |
| D58 | Spec hierarchy / reading order | `AGENTS.md` §0.3 + §4 |
| D59 | Commit & PR conventions (spec ref block) | `AGENTS.md` §5 |
| D60 | "What Done Means" checklist | `AGENTS.md` §12 |
| D61 | Stop-and-ask triggers | `AGENTS.md` §8 |
| D62 | Agent hygiene / close-out / paused state | `AGENTS.md` §9 |
| D63 | Marketing landing page (commercial surface) | `web/07_Landing_Page.md` (implementation) + `product/` directory (copy spec) |
| D64 | Per-platform architecture (web/mobile/desktop) | `web/01_Architecture.md`, `mobile/01_Architecture.md`, `desktop/01_Architecture.md` |
| D65 | Release pipeline (CI/CD) | `deployment/05_CI_CD_GitHub_Actions.md` (master) + `deployment/04_Release_Pipeline.md` (choreography) |
| D66 | Vercel hosting + Blob storage | `deployment/01_Vercel_Hosting.md` + `deployment/02_Vercel_Blob_Build_Storage.md` |
| D67 | EAS mobile build + OTA channels | `deployment/03_EAS_Build_and_Update_Channels.md` + `mobile/05_EAS_Build.md` + `mobile/06_EAS_Update.md` |
| D68 | Desktop code signing + installers + updater | `desktop/04_Code_Signing.md` + `desktop/06_Installers.md` + `desktop/05_Updater.md` |
| D69 | GlassShell (persistent shell, only-`/`-route invariant) | `02_Core_Logic.md` §1 (canonical) + `mobile/03_Navigation_and_State.md` L32 (mobile variant) + `desktop/01_Architecture.md` L174 (desktop variant) |
| D70 | Single-tenant SQLite (1 user = 1 Turso DB) | `00_Vision.md` §10 (manifesto) + `10_Security.md` §2 (provisioning) + `11_Data_Model.md` §1 (schema) |
| D71 | `tenant_id` defence-in-depth + RLS predicate | `10_Security.md` §7 (RLS) + `11_Data_Model.md` §1 (column) + lint `tenant-predicate-required` |
| D72 | Command palette (⌘K / Ctrl+K) | `01_Product_Principles.md` P3 (principle) + `02_Core_Logic.md` §1 (shell mount) + `13_UI_Guidelines.md` §8 (component) |
| D73 | GDPR/DPDP: tutor is controller, Buddysaradhi is processor | `10_Security.md` §22 (compliance posture) |
| D74 | Two-tap rule (P3) | `01_Product_Principles.md` P3 (canonical) + `03_User_Flows.md` (flow-level proof) |
| D75 | Offline-first (P5) | `01_Product_Principles.md` P5 (canonical) + `02_Core_Logic.md` §9 (sync engine) + `mobile/04_Offline_Sync_and_Conflict_Resolution.md` (mobile impl) |
| D76 | Sovereignty / tutor owns data | `00_Vision.md` §10 (canonical) + `01_Product_Principles.md` P10 (backups are yours) + `10_Security.md` §22 (compliance) |
| D77 | Defaults are sacred (P6) | `01_Product_Principles.md` P6 (canonical) + `08_Settings.md` (settings enumeration) |
| D78 | Boring tech (P13) | `01_Product_Principles.md` P13 (canonical) + `02_Core_Logic.md` §9 (LWW choice) + `18_Microservice_Architecture.md` (extraction discipline) |
| D79 | Empty-state promise (P15) | `01_Product_Principles.md` P15 (canonical) + `13_UI_Guidelines.md` §15 (component contract) + `03_User_Flows.md` §onboarding (per-screen empty states) |
| D80 | Sensitive-mutation PIN gate (P11) | `01_Product_Principles.md` P11 (canonical) + `10_Security.md` §4 (PIN matrix) |

---

## 4. Stale Cross-References

Every cross-reference of the form `<NN>_<Foo>.md §<n>` and `§<n>.<m>` was checked against the actual heading list of the target file (via `^## ` grep on each target). The 11 stale references below are P1 issues — an agent following them lands in the wrong section and may implement against the wrong rule. S1–S9 are wrong-section or wrong-filename citations; S10–S11 are §5-for-§1 confusions in the GlassShell invariant (a single mis-citation repeated in 2 files).

| # | Source file:line | Reference text | Problem | Fix |
|---|---|---|---|---|
| S1 | `01_Product_Principles.md:49` | `19_Testing_Requirements.md` | The file `19_Testing_Requirements.md` does **not exist**. The actual file is `19_Concurrency_and_Testing.md`. The name was likely changed when concurrency was folded in. | Rename to `19_Concurrency_and_Testing.md` §5 (per-platform E2E) — that is the section that asserts "≤2 clicks from each of the five screens" via Playwright. |
| S2 | `00_Vision.md:613` (ASCII mockup V2) | `02_Core_Logic.md §1` for "FIVE SCREENS + SEVEN HIDDEN ENGINES" | `02_Core_Logic.md` §1 is "The Shell — GlassShell", not the five-screens/seven-engines map. The five-screens surface map is §2; the seven-engines overview is §4. | Change to `02_Core_Logic.md §2 + §4`. |
| S3 | `00_Vision.md:335` (§11.4 The Immutable Ledger) | `12_Business_Rules.md §2` | `12_Business_Rules.md` §2 is "Fee & Money Rules (BR-FEE)", not the ledger rules. The ledger rules (BR-LED-*) live in §6. | Change to `12_Business_Rules.md §6` (BR-LED-01..06). |
| S4 | `00_Vision.md:170` (§5 screen table) | `12_Business_Rules.md §2` for "Ledger" row | Same as S3 — §2 is BR-FEE, not ledger. | Change to `12_Business_Rules.md §6`. |
| S5 | `15_Future_Roadmap.md:79` (v1.0 truth-spine row) | `12_Business_Rules.md §3` for "Append-only ledger_entries" | `12_Business_Rules.md` §3 is "Attendance Rules (BR-ATT)", not ledger. | Change to `12_Business_Rules.md §6` (BR-LED-*). |
| S6 | `03_User_Flows.md:25` (§1 Offline Invariant) | `02_Core_Logic.md §6` for "The sync engine" | `02_Core_Logic.md` §6 is "The Ledger Engine — Deep Dive", not the Sync Engine. The Sync Engine is §9. | Change to `02_Core_Logic.md §9`. |
| S7 | `03_User_Flows.md:183` (Arjun's Saturday timeline) | `02_Core_Logic.md §6` for "**Sync Engine** — LWW conflict resolution" | Same as S6 — §6 is Ledger, §9 is Sync. | Change to `02_Core_Logic.md §9`. |
| S8 | `19_Concurrency_and_Testing.md:98` | `AGENTS.md §7.2 "never mock the ledger"` | `AGENTS.md` §7.2 is "What MUST Be Tested" (a table of test concerns). The "never mock the ledger" rule is defined in **§7.3**, not §7.2. | Change to `AGENTS.md §7.3`. |
| S9 | `01_Product_Principles.md:85, :213, :411` | `02_Core_Logic.md §Sync Engine` (name-based, no number) | The rest of the spec uses numbered references (`§6`, `§9`); this name-based reference is inconsistent. The Sync Engine section is §9. | Change all three to `02_Core_Logic.md §9` to match the spec's numbered-reference convention. |
| S10 | `AGENTS.md:199` (§3.2 Web stack snapshot) | `02_Core_Logic.md §5` for "screen switching is Zustand-driven inside `GlassShell`" | `02_Core_Logic.md` §5 is "Engine State Machines", not the GlassShell or screen-switching spec. GlassShell is §1; Screen State Machines is §3. | Change to `02_Core_Logic.md §1` (for the persistent-shell invariant) or `§3` (for the Zustand screen state machines). |
| S11 | `07_Fees_and_Payments.md:62` | `02_Core_Logic.md §5` for "persistent `GlassShell`; only `/` is exposed as a route" | Same as S10 — §5 is Engine State Machines. The persistent-shell + only-`/`-route invariant lives in §1 (and the routing map is §18, which is itself superseded per §7 U1). | Change to `02_Core_Logic.md §1`. |

**Audit note on near-misses (kept for the record):** `mobile/03_Navigation_and_State.md:183` cites `AGENTS.md (top-level) §6.3` for the sticky-footer rule — this is **valid** (`AGENTS.md` §6.3 IS "The Sticky-Footer Rule (Web)"). `web/README.md:198` cites `02_Core_Logic.md §6.7` — this is **valid** (§6.7 is "Lock-After-24h Rule"). `product/03_Features_Showcase.md:289` cites `02_Core_Logic.md §6` for "Append-only, hash-chained fees ledger" — this is **valid** (§6 is the Ledger Engine deep dive). These three were initially suspected stale and cleared on second read.

---

## 5. Precedence Rules (when two docs disagree)

When two specs make a claim about the same topic and the claims diverge, this table decides the winner. The general rule: **for a statement of principle, the foundational doc wins (`00`–`01`); for an implementation contract, the most-specific doc wins (`16`–`20` or the per-platform subdir); for a rule ID, `12_Business_Rules.md` always wins.**

| # | Topic | Doc A says | Doc B says | Which wins | Why |
|---|---|---|---|---|---|
| P1 | Five-screen ceiling vs federation admin role | `01_Product_Principles.md` P2: "Five screens, forever — a sixth requires a ratified amendment." | `15_Future_Roadmap.md` v3.0: "P2 Amendment 1 carves a narrow exception for the federation admin role (a conditional 'Team' panel)." | **`15` wins for the federation case; `01` wins everywhere else.** | The amendment is the ratified exception P2 itself permits. The solo-tutor product remains five screens. The amendment is scoped, not a repeal. |
| P2 | Two-tap rule vs five-screen ceiling | `01_Product_Principles.md` P3: "Any primary action ≤2 taps from any screen." | `01_Product_Principles.md` P2: "Five screens only." (When a feature would need a 6th screen to satisfy P3.) | **P2 wins.** (Stated explicitly in `01` §Resolution Matrix L284.) | A 6th screen is never the answer to P3; the feature goes inside an existing screen as a sub-screen, drawer, or modal. |
| P3 | Indigo canvas vs no-indigo accent | `13_UI_Guidelines.md` §1.2: "The cosmic indigo→violet gradient is the canvas." | `01_Product_Principles.md` AP-6: "Indigo or blue as primary accent is forbidden." | **Both win, in their respective scopes.** | The canvas is neutral; the accent is the brand. AP-6 explicitly carves "canvas ≠ accent" (`01` L310). No conflict when read in scope. |
| P4 | Boring tech (LWW) vs v2.0 vector clocks | `01_Product_Principles.md` P13: "Use boring tech; UUID append-only ledger + LWW beats exotic CRDTs." | `15_Future_Roadmap.md` v2.0: "Vector clocks for cross-device sync." | **P13 wins for v1.x; `15` v2.0 wins for v2.x.** | P13's "boring tech" is the v1.x choice. v2.0's vector clocks are a deliberately scoped evolution, ratified as a roadmap amendment. P13 is not violated because the ledger itself stays UUID-append-only; only non-ledger rows gain vector clocks. |
| P5 | No telemetry vs Vercel Web Analytics | `AGENTS.md` Rule 3: "No analytics SDK — not even 'anonymous' ones." | `product/09_SEO_and_Analytics.md` §6: "Vercel Web Analytics is allowed (aggregate-only, no cookies, no PII)." | **`product/09` wins for Vercel Web Analytics specifically; Rule 3 wins for everything else.** | Rule 3's intent is "no SDK that exfiltrates user data." Vercel Web Analytics is server-side aggregate (no client SDK, no cookies, no PII), so it does not exfiltrate. The exception is narrow and named. |
| P6 | "Free for everyone, for now" vs §1.6 paid-tier launch | `12_Business_Rules.md` BR-PRC-01: "₹0/mo for every tutor, every feature." | `product/05_Pricing_and_Plans.md` §1.6 + BR-PRC-04: "Pro ₹299/mo and Institute ₹999/mo launch on the §1.6 trigger, with 60-day notice." | **BR-PRC-01 wins pre-trigger; BR-PRC-02 (grandfather) + BR-PRC-04 win post-trigger.** | The trigger is the explicit handover. Post-trigger, the grandfather clause (BR-PRC-02) protects pre-trigger signups; new signups still get ₹0/mo Free, with Pro/Institute as voluntary upgrades. No conflict when scoped by trigger state. |
| P7 | 250-student soft guidance vs no-paywall rule | `12_Business_Rules.md` BR-STU-11: "250 is internal soft guidance; logs `student_count_milestone`." | `12_Business_Rules.md` BR-PRC-03: "NO paywall in v1 — 251st student is never blocked." | **Both win jointly.** | BR-STU-11 defines the milestone; BR-PRC-03 forbids using it as a block. They are complementary, not contradictory. A 251st student triggers the milestone log + friendly prompt (BR-STU-11) AND is fully created (BR-PRC-03). |
| P8 | Receipt numbering monotonicity vs "fix the number" tutor request | `12_Business_Rules.md` BR-RC-01: "next_invoice_seq / next_receipt_seq never decrement; gaps are intentional." | `01_Product_Principles.md` P1: "The tutor is the user; tutor's convenience wins." (When a tutor demands "just let me fix the wrong receipt number.") | **BR-RC-01 wins.** (Stated in `01` P4 Tension & Resolution L67.) | Long-term auditability outweighs short-term convenience. The fix is VOID + new receipt (BR-LED-03), not a renumber. |
| P9 | Sticky footer (mandatory) vs marketing layout freedom | `13_UI_Guidelines.md` §13 + `AGENTS.md` §6.3: "Sticky footer is mandatory on web." | `web/07_Landing_Page.md` §11: marketing layout uses `min-h-screen flex flex-col` + `mt-auto` (the same rule). | **Both win — they agree.** | The marketing layout implements the sticky-footer rule; it does not override it. No conflict. |
| P10 | One-platform-In-Flight vs one-task-In-Flight | `16_Platform_Delivery_Sequence.md` §1: "Exactly one platform In-Flight at any time." | `AGENTS.md` §9.2.1: "Single in-flight task per agent." | **Both win — they operate at different scopes.** | §16 is about platforms (web/mobile/desktop); `AGENTS.md` §9.2 is about tasks within a single agent's session. An agent working on web can be in-flight on one task; that task must not touch mobile or desktop. |
| P11 | "Edit a payment" demand vs immutable ledger | `01_Product_Principles.md` P4: "Edit a payment is impossible; post a reversing entry." | `01_Product_Principles.md` P1: "The tutor is the user." (Tutor demands "just let me edit the number.") | **P4 wins.** (Stated explicitly in `01` P4 Tension & Resolution L67.) | This is the canonical P1↔P4 conflict. P4 wins because long-term correctness outweighs short-term convenience. The tutor is protected from their own fat-finger mistake. |
| P12 | Five screens vs parent portal (P14) | `01_Product_Principles.md` P2: "Five screens, forever." | `01_Product_Principles.md` P14: "Parent is a guest." (When a parent portal is requested as a 6th screen.) | **P2 wins.** (Stated in `01` P2 Tension & Resolution L19.) | The parent surface in v1 is a signed URL — not a screen, not an app, not a login. P14 is satisfied without violating P2. |
| P13 | Boring tech (P13) vs shippable-now (P12) | `01_Product_Principles.md` P13: "Use boring tech; Framer Motion is sufficient." | `01_Product_Principles.md` P12: "Minutes-per-day." (When a shinier animation library would shave a tap.) | **P13 wins for tech choice; P12 wins for UX flow.** (Stated in `01` P13 Tension & Resolution L211.) | The library stays boring; the flow gets the shave. The two principles operate on different axes. |
| P14 | Defaults are sacred (P6) vs tutor wants different default | `01_Product_Principles.md` P6: "Every setting ships with the value a competent tutor would choose." | `01_Product_Principles.md` P1: "The tutor is the user." (Tutor wants a different default fee model.) | **P6 wins for the default; P1 wins for the override.** (Stated in `01` P6 Tension & Resolution L99.) | P6 forbids *requiring* configuration; it does not forbid *allowing* override. The tutor can change the default; the default is still sacred for the next new user. |
| P15 | Sovereignty (P10) vs cloud sync convenience | `01_Product_Principles.md` P10: "Backups are yours; no vendor cloud." | `01_Product_Principles.md` P5: "Offline-first." (When a tutor asks for automatic cloud sync of backups.) | **P10 wins for backups; P5 wins for the ledger replica.** | The `.buddysaradhi` backup file is tutor-owned and tutor-destination (Drive, pendrive, iCloud). The Turso cloud DB is a *replica* of the local SQLite, not a backup. The two principles operate on different artefacts. |

---

## 6. Prose-to-Table Candidates

Each of the following 16 locations is a paragraph (or set of paragraphs) that would scan faster and shrink by 30–60% as a table. The "proposed table" column sketches the header row.

**Why convert to tables?** Three reasons: (1) **Scannability** — an agent looking for "what gate W4 checks" finds it in one row of a 7-row table, not in a 7-bullet list. (2) **Diff-cleanliness** — adding a new gate criterion is a new row, not a reflowed paragraph. (3) **Auditability** — a table makes missing rows visible ("there should be 7 W-gates; this table has 6 — which is missing?"). The cost is real: tables are harder to write prose-rich justifications in. The candidates below are locations where the prose is already structured (a fixed enumeration, a comparison, a state matrix) and the justification is short.

**Before/after sketch for T1 (the highest-value candidate):**

*Before (current, ~45 lines across §4–§6 of `16_Platform_Delivery_Sequence.md`):*

```
§4. P1 — Web: Definition of Production-Done
  - W1. The five product screens render in Agent Browser on mobile + desktop
    widths with the sticky footer rule satisfied.
  - W2. The API gateway from 17_API_Gateway_System.md is live and all web data
    access flows through it.
  - W3. ...

§5. P2 — Mobile: Definition of Production-Done
  - M1. The five mobile tabs render at 375px and 768px with the tab bar per
    13_UI_Guidelines.md §8.6.
  - M2. All network access flows through the same API gateway at the same
    contracts/v1.0.0 tag.
  - M3. ...

§6. P3 — Desktop: Definition of Production-Done
  - D1. The five screens render inside the Tauri webview on macOS 12+,
    Windows 10+, Ubuntu 22.04+.
  - D2. ...
```

*After (proposed, ~12 lines as a single table):*

| Gate # | Web (W) | Mobile (M) | Desktop (D) |
|---|---|---|---|
| 1. Renders | 5 screens, mobile+desktop widths, sticky footer (W1) | 5 tabs, 375px+768px, tab bar per §8.6 (M1) | 5 screens in Tauri webview, macOS 12+/Win10+/Ubuntu 22.04+ (D1) |
| 2. Gateway | 17_API_Gateway_System.md live, all data via gateway (W2) | Same gateway, same contracts/v1.0.0 tag (M2) | Same gateway, same contracts/v1.0.0 tag (D2) |
| ... | ... | ... | ... |

The table makes the parallel structure of the three platforms visible at a glance — the prose version hides it.

| # | File:line range | Current prose | Proposed table (header row) |
|---|---|---|---|
| T1 | `16_Platform_Delivery_Sequence.md` §4–§6 (lines 92–137) | Three separate bulleted lists: W1–W7, M1–M7, D1–D7. Each list restates "the platform renders, the gateway is live, lint clean, etc." with platform-specific phrasing. | **Gate # \| Web (W) \| Mobile (M) \| Desktop (D)** — 7 rows, one per gate criterion (renders, gateway, contract-frozen, lint+types, tests, a11y, 3D page), with the platform-specific assertion in each cell. Drops 3 bulleted lists to 1 table. |
| T2 | `01_Product_Principles.md` P1–P15 "Tension & Resolution" paragraphs (e.g. L51, L67, L83, L99) | Each principle has a 2–4 sentence "Tension & Resolution" paragraph naming which other principles it tensions with and how it resolves. 15 paragraphs total. | **Principle \| Tensions with \| Resolution** — 15 rows. Already partially done at L284–294 (a 4-row summary); extend it to all 15 principles and DELETE the inline paragraphs. |
| T3 | `00_Vision.md` §11.4 "The Immutable Ledger" (L333–L336) | 3-sentence prose paragraph restating P4 + citing `12_Business_Rules.md §2` (which is itself stale — see §4 S3). | **Aspect \| Rule** — 4 rows: "Mutability" / "Correction mechanism" / "Balance derivation" / "Audit trail". Or, simpler: replace the whole paragraph with a single line cross-referencing `01_Product_Principles.md` P4 + `12_Business_Rules.md` §6. |
| T4 | `13_UI_Guidelines.md` §7 "Motion Principles & Microinteraction Catalogue" (L435–L487) | Running prose describing motion easing curves, durations, and per-component microinteractions. | **Component \| Trigger \| Duration \| Easing \| Honours `prefers-reduced-motion`?** — ~12 rows. Each row replaces a 2-sentence prose block. |
| T5 | `17_API_Gateway_System.md` §2 "The Contract" (L20–L80) | Prose explanation of what the contract is, who generates it, how clients consume it, what happens on drift. | **Concern \| Rule \| Enforced by** — ~6 rows: "Source of truth" / "Client access" / "Drift detection" / "Version pinning" / "Error contract" / "Auth". |
| T6 | `09_Backup_and_Import_Export.md` §3 envelope format spec | Prose describing the byte layout: `salt(16) ‖ nonce(12) ‖ tag(16) ‖ ciphertext`, KDF params, etc. | **Offset \| Length \| Field \| Notes** — 4 rows for the envelope + 4 rows for KDF params. A byte-offset table is the standard way to spec a binary format. |
| T7 | `03_User_Flows.md` Flow 01–15 (each flow is a numbered step list in prose) | Each flow is ~10–20 numbered steps in prose ("Step 1: tap X. Step 2: …"). 15 flows × ~15 steps each ≈ 225 lines. | **Step \| Actor \| Action \| System response \| Spec ref** — ~15 rows per flow. Drops the per-flow word count by ~50%. |
| T8 | `14_Edge_Cases.md` EC-* entries (each is "Trigger / Behaviour / Recovery / Governing / Priority" prose) | ~60 edge-case entries, each with 4–5 prose paragraphs. | **EC-ID \| Trigger \| Behaviour \| Recovery \| Governing \| Priority** — already partially structured but in prose; converting to a true table per EC family (EC-SY, EC-SEC, EC-F, EC-PRC, etc.) makes the matrix scannable. |
| T9 | `02_Core_Logic.md` §13 "Core Algorithms — Pseudocode Reference" (L640–L760) | Each algorithm (running balance, hash chain, fee calc, attendance %, due-date, etc.) is a pseudocode block + a prose explanation. The prose explanations overlap. | **Algorithm \| Inputs \| Outputs \| Invariants \| Spec ref** — ~10 rows. The pseudocode blocks stay; the prose explanations become the table. |
| T10 | `15_Future_Roadmap.md` "Explicitly Never List" (around L290–L320) | A bulleted list of "things we will never build" with one-sentence justifications. ~15 items. | **Item \| Why never \| Governing principle** — 15 rows. Converts a 45-line bulleted list to a 20-line table. |
| T11 | `08_Settings.md` settings enumeration | Each setting is a prose block: "Setting name / default / range / why this default." ~25 settings. | **Setting \| Default \| Range \| Justification \| Governing principle** — 25 rows. Already partially tabular at the top of the file; extend the table to cover all settings and DELETE the per-setting prose blocks. |
| T12 | `web/07_Landing_Page.md` §5 section breakdown (L260–L400) | Prose describing each section of the landing page (hero, features, pricing, FAQ, CTA, etc.) with depth, components, and copy. ~12 sections. | **Section \| Viewport depth \| Primary component \| Copy spec \| Spec ref** — 12 rows. Drops ~140 lines of prose to ~30 lines of table. |
| T13 | `02_Core_Logic.md` §23 "The Five Screens → Engine Dependency Matrix" (L932–L945) | Currently a 5-row × 7-col ASCII grid in a code block. The same content as a markdown table is screen-reader-friendly and diff-clean. | **Screen \| Search \| Reminder \| Ledger \| Report \| Notification \| Sync \| Security** — 5 rows. Convert the ASCII grid to a markdown table; keep the ASCII version as a §20-compliance mockup below. |
| T14 | `10_Security.md` §4 "Sensitive-Mutation PIN & Export Controls Matrix" (L157–L175) | Prose describing which mutations require PIN, which require biometric, which require both, and which are blocked. | **Mutation \| PIN required? \| Biometric required? \| Audit log action \| Spec ref** — ~15 rows. Already partially tabular but the rows are scattered; consolidate. |
| T15 | `10_Security.md` §3 "App Lock — PIN & Biometric Architecture" (L50–L116) | Prose describing the 5/10/15 failed-PIN attempt ladder, the 30s/5min/wipe timeouts, and the biometric fallback. | **Failed attempts \| Lockout duration \| Next step \| Audit log action** — 3 rows (5, 10, 15) + a biometric-fallback row. Drops ~30 lines of prose to ~6 lines of table. |
| T16 | `19_Concurrency_and_Testing.md` §8 "Implementation Order" (L233–L250) | A numbered list of 9 implementation steps with sub-bullets. Each step is "add lint X / extract service Y / re-clear gate Z." | **Step # \| Action \| Touches \| Gate re-clear required? \| Spec ref** — 9 rows. Drops ~18 lines of prose to ~12 lines of table. |

---

## 7. Superseded Sections

Sections in `00`–`15` that have been overtaken by a newer, more authoritative doc in `16`–`20` or in a per-platform subdir. For each: the superseded section, the superseding doc, and the recommended action.

| # | Superseded section | Superseding doc | Recommended action |
|---|---|---|---|
| U1 | `02_Core_Logic.md` §18 "Routing Map (Web)" (L863–L878) | `web/01_Architecture.md` §4 (route table) + `web/02_State_and_Data_Flow.md` (Zustand screen switching) | **Replace with a 2-line cross-ref.** The web route table is now authoritative in `web/01`; `02_Core_Logic.md` is the engine spec, not the route spec. Keep a one-line summary: "Web routes: see `web/01_Architecture.md` §4. Only `/` is user-facing; screen switching is Zustand-driven in `GlassShell`." |
| U2 | `02_Core_Logic.md` §19 "The Three Platform Bindings" (L879–L890) | `web/01_Architecture.md`, `mobile/01_Architecture.md`, `desktop/01_Architecture.md` (the three per-platform architecture specs) | **Replace with a 3-line cross-ref table.** Each platform now has its own 700+ line architecture spec; the 11-line summary in `02_Core_Logic.md` is stale and incomplete. |
| U3 | `02_Core_Logic.md` §17 "Navigation State Model (Zustand)" (L845–L862) | `web/02_State_and_Data_Flow.md` (web Zustand stores) + `mobile/03_Navigation_and_State.md` (mobile navigation) | **Replace with a cross-ref.** The Zustand store shapes are now spec'd per-platform in the `web/` and `mobile/` subdirs. |
| U4 | `00_Vision.md` §16 "Platforms & Distribution" | `15_Future_Roadmap.md` (platforms roadmap) + `16_Platform_Delivery_Sequence.md` (delivery order) + `web/README.md`, `mobile/README.md`, `desktop/README.md` | **Keep `00_Vision.md` §16 as a 1-paragraph manifesto; move the platform enumeration to a cross-ref.** The detailed platform list, release order, and gate criteria live in `16` + the per-platform READMEs. |
| U5 | `AGENTS.md` §3.1 "Per-Directory Directives" table (L183–L195) | `web/AGENTS.md`, `mobile/AGENTS.md`, `desktop/AGENTS.md`, `deployment/AGENTS.md`, `product/AGENTS.md` (each subdir now has its own AGENTS.md) | **Keep the top-level table as a 5-row index; delete the per-row "Agent should / should NOT" columns.** Those columns are now authoritative in each subdir's AGENTS.md, which carries 200+ lines of platform-specific directives. The top-level table is a 1-line pointer per directory. |
| U6 | `AGENTS.md` §7 "Testing Conventions" (L365–L420) — partial | `19_Concurrency_and_Testing.md` §2 (coverage floors) + §3 (concurrency harness) + §5 (per-platform E2E) | **Keep `AGENTS.md` §7.1 (the test pyramid) and §7.3 (never-mock-the-ledger rule). Move §7.2 (what MUST be tested) and §7.4 (CI gate) into a cross-ref to `19_Concurrency_and_Testing.md` §2 + §6.** The coverage floors and per-platform gates are now authoritative in `19`. |
| U7 | `03_User_Flows.md` Flow 10 "Void receipt cascade" | `07_Fees_and_Payments.md` §9 (the deeper screen-spec treatment of the void cascade) | **Keep `03_User_Flows.md` Flow 10 as a 5-step summary; cross-ref `07_Fees_and_Payments.md` §9 for the full cascade (PIN, audit, hash-chain, receipt renumber).** The screen spec is now the authoritative implementation contract. |
| U8 | `15_Future_Roadmap.md` v1.x mobile/desktop prose (L640–L720) | `mobile/` directory (7 files, 5,000+ lines) + `desktop/` directory (6 files, 5,000+ lines) | **Keep the v1.x roadmap section as a milestone table (version → platform → ship-quarter). Delete the per-platform prose; cross-ref the subdir READMEs.** The per-platform subdirs now carry the authoritative stack, navigation, and build specs. |
| U9 | `00_Vision.md` §19.3 "Mockup V2 — The 5 Screens + 7 Hidden Engines Map" (L610+) — partial | `13_UI_Guidelines.md` §20 (ASCII Art Conventions) + `02_Core_Logic.md` §23 (Five Screens → Engine Dependency Matrix) | **Keep the mockup but retitle the citation.** The mockup pre-dates the §20 convention; it should be re-annotated to comply with §20.2 character set + accent-naming rules. The §1 citation in the mockup title is stale (see §4 S2). |
| U10 | `02_Core_Logic.md` §20 "The Provisioning Flow (1 User = 1 Turso DB)" (L892–L906) | `web/03_Auth_and_Provisioning.md` (the full web auth + provisioning spec, 730 lines) + `10_Security.md` §2 (the trust-model + provisioning security spec) | **Keep `02_Core_Logic.md` §20 as a 5-line summary; cross-ref `web/03_Auth_and_Provisioning.md` for the full flow (Supabase OIDC → provision-db edge function → Turso scoped JWT → user_metadata) and `10_Security.md` §2 for the trust model.** The provisioning flow is now spec'd end-to-end in those two files. |
| U11 | `12_Business_Rules.md` §17 "ASCII Art Mockup Suite" (L397–L699) — partial | `13_UI_Guidelines.md` §20 (the spec-wide ASCII convention) | **Keep `12_Business_Rules.md` §17 mockups (they are rule-specific visualisations: BR-LED hash chain, BR-SYN LWW flow, etc.); replace the per-mockup `§20` preamble re-statement with a one-line cross-ref per §2 R1.** The mockups themselves are not superseded; only their preamble prose is. |

---

## 8. The Redundancy Lint (CI-enforced)

To prevent the redundancies in §2 from creeping back, this audit proposes a new CI lint: `tools/no-duplicate-sections.test.ts`. The lint:

1. **Parses every `.md` file** under `buddysaradhi_Planning/` (top-level + all subdirs).
2. **Extracts every H2 heading** (lines matching `^## `).
3. **Flags any H2 heading that appears identically in >1 file**, with the following **allowlist** of intentionally-duplicated headings (these are structural conventions, not content drift):
   - `## Cross-References` — every spec file ends with one; the content differs per file.
   - `## ASCII Mockup Suite (§20 Compliance)` — every spec file that ships mockups has one; the mockups differ per file.
   - `## Anti-Patterns for Agents` — every AGENTS.md file has one; the rows differ per platform. (But see R11: the rows must be platform-specific, not duplicated from the master list. The lint flags duplicate *headings*, not duplicate *rows*; a separate `no-duplicate-anti-pattern-rows.test.ts` is proposed for the row-level check.)
   - `## Glossary` — multiple files define glossaries scoped to their topic.
4. **Fails the build** with a clear message naming both files and the duplicated heading, **unless** the heading is in the allowlist.

**Implementation sketch:**

```typescript
// tools/no-duplicate-sections.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'buddysaradhi_Planning';
const ALLOWLIST = new Set([
  'Cross-References',
  'Cross-References & Non-Negotiables',
  'Cross-Reference Index',
  'Cross-Reference Quick Table',
  'Platform Directory Cross-References',
  'ASCII Mockup Suite (§20 Compliance)',
  'Anti-Patterns for Agents',
  'Anti-Patterns for Release-Eng Agents',
  'Anti-Patterns Specific to Web',
  'Common Anti-Patterns for Mobile Agents',
  'Navigation Anti-Patterns (What NOT to Do)',
  'What Is NOT Tested (Anti-Patterns)',
  'Common Pitfalls (Anti-Patterns)',
  'Glossary',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
  });
}

function h2headings(file: string): string[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const result: string[] = [];
  let inFence = false;
  for (const l of lines) {
    if (l.startsWith('```')) inFence = !inFence; // toggle fenced-code-block state
    if (inFence) continue; // skip lines inside ``` blocks (they are literal text, not headings)
    if (l.startsWith('## ')) result.push(l.replace(/^## /, '').trim());
  }
  return result;
}

describe('no duplicate H2 sections across files (allowlist: structural conventions)', () => {
  const files = walk(ROOT);
  const headingToFiles = new Map<string, string[]>();
  for (const f of files) {
    for (const h of h2headings(f)) {
      if (ALLOWLIST.has(h)) continue;
      const arr = headingToFiles.get(h) ?? [];
      arr.push(f);
      headingToFiles.set(h, arr);
    }
  }
  for (const [heading, owners] of headingToFiles) {
    if (owners.length > 1) {
      it(`H2 "${heading}" appears in ${owners.length} files: ${owners.join(', ')}`, () => {
        expect(owners.length, `Duplicate H2 "${heading}" in:\n  ${owners.join('\n  ')}\nMove content to one canonical home; replace elsewhere with a cross-ref, or add to ALLOWLIST if structural.`).toBe(1);
      });
    }
  }
});
```

**Companion lint (proposed, separate file):** `tools/no-duplicate-anti-pattern-rows.test.ts` — parses every AGENTS.md `## Anti-Patterns` table, extracts column 2 (the anti-pattern description), and fails if the same description appears in >1 AGENTS file. This enforces R11: per-platform AGENTS files keep only platform-specific rows; the master list lives in top-level `AGENTS.md` §10.

---

## 9. Post-Audit Action Checklist

This is the work ticket for the next agent who wants to physically dedup the docs. **Do NOT execute from this file** — this is the AUDIT, not the execution. Each item is marked `[ ] TODO` and cites the redundancy/stale-ref/superseded-section finding it implements.

### Stale cross-reference fixes (§4) — do first, lowest risk

- [ ] **TODO S1** — `01_Product_Principles.md:49` — change `19_Testing_Requirements.md` → `19_Concurrency_and_Testing.md` §5.
- [ ] **TODO S2** — `00_Vision.md:613` — change `02_Core_Logic.md §1` → `02_Core_Logic.md §2 + §4`.
- [ ] **TODO S3** — `00_Vision.md:335` — change `12_Business_Rules.md §2` → `12_Business_Rules.md §6`.
- [ ] **TODO S4** — `00_Vision.md:170` — change `12_Business_Rules.md §2` → `12_Business_Rules.md §6`.
- [ ] **TODO S5** — `15_Future_Roadmap.md:79` — change `12_Business_Rules.md §3` → `12_Business_Rules.md §6`.
- [ ] **TODO S6** — `03_User_Flows.md:25` — change `02_Core_Logic.md §6` → `02_Core_Logic.md §9`.
- [ ] **TODO S7** — `03_User_Flows.md:183` — change `02_Core_Logic.md §6` → `02_Core_Logic.md §9`.
- [ ] **TODO S8** — `19_Concurrency_and_Testing.md:98` — change `AGENTS.md §7.2` → `AGENTS.md §7.3`.
- [ ] **TODO S9** — `01_Product_Principles.md:85, :213, :411` — change `02_Core_Logic.md §Sync Engine` → `02_Core_Logic.md §9` (3 edits).
- [ ] **TODO S10** — `AGENTS.md:199` — change `02_Core_Logic.md §5` → `02_Core_Logic.md §1` (for GlassShell persistence) or `§3` (for Zustand screen state machines).
- [ ] **TODO S11** — `07_Fees_and_Payments.md:62` — change `02_Core_Logic.md §5` → `02_Core_Logic.md §1`.

### Redundancy dedup (§2) — medium risk, do file-by-file

- [ ] **TODO R1** — In 13 files (list in §2 R1), replace the 6-bullet ASCII Mockup Suite preamble with a one-liner citing `13_UI_Guidelines.md §20`. Keep the box-width rule + the "the three mockups below visualise…" sentence in each file (those are file-specific).
- [ ] **TODO R2** — In `00_Vision.md` L474+L388, `15_Future_Roadmap.md` L451, `mobile/AGENTS.md` L495, `mobile/README.md` L121, `product/07_CTA_and_Conversion.md` L360 — replace the "Free for everyone, for now" + 250-student paragraph with a one-line cross-ref to `12_Business_Rules.md` BR-PRC-01 + BR-STU-11.
- [ ] **TODO R3** — In `05_Students.md` L5, `mobile/AGENTS.md` L11+L267, `desktop/AGENTS.md` L201, `deployment/AGENTS.md` L120, `product/AGENTS.md` L247, `web/README.md` L204, `product/README.md` L290, `desktop/README.md` L128 — replace the full bioluminescent hex list with a one-line cross-ref to `13_UI_Guidelines.md §2.1` + AP-6.
- [ ] **TODO R4** — In `17_API_Gateway_System.md` §11, `18_Microservice_Architecture.md` §1+L79+L105+L320, `19_Concurrency_and_Testing.md` §1+L246, `20_3D_Product_Page.md` §1+L155+L282, `web/AGENTS.md` L15+L19, `mobile/AGENTS.md` L15, `desktop/AGENTS.md` L15 — replace the Production Gate re-statement with a one-line cross-ref to `16_Platform_Delivery_Sequence.md` §3–§6.
- [ ] **TODO R5** — In `19_Concurrency_and_Testing.md` L203+L238, `web/AGENTS.md` L22, `mobile/AGENTS.md` L23 — replace the no-hardcoded-ingress re-statement with a one-line cross-ref to `17_API_Gateway_System.md` §2.2.
- [ ] **TODO R6** — In `mobile/AGENTS.md` L306, `desktop/02_Rust_Core.md` L1032 — replace the never-mock-the-ledger re-statement with a one-line cross-ref to `AGENTS.md` §7.3.
- [ ] **TODO R7** — In `web/01_Architecture.md` L250+L677, `web/07_Landing_Page.md` L746+L767, `web/AGENTS.md` L199+L240+L412+L446, `deployment/01_Vercel_Hosting.md` L393+L597, `desktop/AGENTS.md` L366+L419 — replace the sticky-footer rule restatement with a one-line cross-ref to `13_UI_Guidelines.md` §13 + `AGENTS.md` §6.3.
- [ ] **TODO R9** — In `00_Vision.md` §11.4, `07_Fees_and_Payments.md` §1, `web/04_API_Routes.md` L687 — replace the immutable-ledger rule restatement with a one-line cross-ref to `01_Product_Principles.md` P4 + `12_Business_Rules.md` §6 BR-LED-*.
- [ ] **TODO R10** — In `15_Future_Roadmap.md` L80, `18_Microservice_Architecture.md` L23, `mobile/02_Native_Modules_and_Storage.md` L1069, `desktop/02_Rust_Core.md` L1006 — replace the AES-256-GCM + Argon2id envelope re-statement with a one-line cross-ref to `10_Security.md` §15 + `09_Backup_and_Import_Export.md` §11.
- [ ] **TODO R11** — In `web/AGENTS.md` §10, `mobile/AGENTS.md` §8, `desktop/AGENTS.md` (anti-patterns table), `deployment/AGENTS.md` §8, `product/AGENTS.md` — DELETE rows that duplicate the master list in `AGENTS.md` §10. Keep only platform-specific rows.
- [ ] **TODO R13** — In `03_User_Flows.md` §6, `15_Future_Roadmap.md` v1.2 — replace the WCAG/44px/reduced-motion restatement with a one-line cross-ref to `13_UI_Guidelines.md` §10 + Rule 10.
- [ ] **TODO R14** — In `AGENTS.md` §10 — DELETE anti-pattern row 22 (it duplicates row 16; both say "Reuse a voided invoice/receipt number").
- [ ] **TODO R16** — In `05_Students.md` L543+L949, `09_Backup_and_Import_Export.md` L428, `15_Future_Roadmap.md` (single-tenant mentions) — replace the single-tenant/`tenant_id` restatement with a one-line cross-ref to `10_Security.md` §2 + §7.
- [ ] **TODO R17** — In `AGENTS.md` L199, `web/AGENTS.md` L11, `web/README.md` L155, `07_Fees_and_Payments.md` L62, `08_Settings.md` L42 — replace the GlassShell persistence restatement with a one-line cross-ref to `02_Core_Logic.md` §1. (Pairs with S10 + S11.)

### Superseded-section replacements (§7) — higher risk, review per item

- [ ] **TODO U1** — `02_Core_Logic.md` §18 — replace the routing map with a 2-line cross-ref to `web/01_Architecture.md` §4.
- [ ] **TODO U2** — `02_Core_Logic.md` §19 — replace the three-platform-bindings summary with a 3-line cross-ref table.
- [ ] **TODO U3** — `02_Core_Logic.md` §17 — replace the Zustand navigation model with a cross-ref to `web/02_State_and_Data_Flow.md` + `mobile/03_Navigation_and_State.md`.
- [ ] **TODO U4** — `00_Vision.md` §16 — keep the 1-paragraph manifesto; move the platform enumeration to a cross-ref to `15` + `16` + per-platform READMEs.
- [ ] **TODO U5** — `AGENTS.md` §3.1 — drop the "Agent should / should NOT" columns; keep the 5-row directory index.
- [ ] **TODO U6** — `AGENTS.md` §7.2 + §7.4 — replace with a cross-ref to `19_Concurrency_and_Testing.md` §2 + §6. Keep §7.1 (pyramid) + §7.3 (never-mock-the-ledger).
- [ ] **TODO U7** — `03_User_Flows.md` Flow 10 — keep the 5-step summary; cross-ref `07_Fees_and_Payments.md` §9 for the full cascade.
- [ ] **TODO U8** — `15_Future_Roadmap.md` v1.x mobile/desktop prose — keep the milestone table; delete the per-platform prose; cross-ref the subdir READMEs.
- [ ] **TODO U9** — `00_Vision.md` §19.3 mockup — re-annotate to comply with `13_UI_Guidelines.md` §20.2; fix the §1 citation per S2.
- [ ] **TODO U10** — `02_Core_Logic.md` §20 (Provisioning Flow) — keep the 5-line summary; cross-ref `web/03_Auth_and_Provisioning.md` + `10_Security.md` §2 for the full flow.
- [ ] **TODO U11** — `12_Business_Rules.md` §17 mockup preambles — replace per-mockup `§20` re-statement with a one-line cross-ref (pairs with R1).

### Prose-to-table conversions (§6) — lowest risk, do last

- [ ] **TODO T1** through **TODO T16** — convert the 16 prose locations listed in §6 to tables. Each is an independent edit; do them in any order. Priority: T1 (Production Gate matrix), T8 (EC-* entries), T11 (settings enumeration) — these have the highest line-count savings.

### 9.1 Edit Ordering Recommendation

The §9 checklist has dependency edges. The recommended execution order:

1. **Phase A — stale-ref fixes (S1–S11).** Land as a single PR. These are 11 one-line edits; they touch no prose, only citation strings. Lowest risk, highest value (an agent following a stale ref today lands in the wrong section). PR title: `docs: fix 11 stale cross-references per 22_Redundancy_Audit.md §4`.
2. **Phase B — P1 dedup (R1, R2, R11, R14).** Land as a single PR per redundancy. R1 (ASCII preamble) is the highest-value: it removes ~30 lines × 13 files = ~390 lines of duplicated prose. R2 (pricing paragraph) removes ~5 lines × 7 files = ~35 lines. R11 (anti-pattern rows) is row-level, requires careful per-platform review. R14 is a single-row delete.
3. **Phase C — P2 dedup (R3–R10, R13, R15–R17).** Land as a single PR per redundancy. Each is a one-line cross-ref replacement. Pair R17 with the S10+S11 fixes from Phase A (they touch the same lines).
4. **Phase D — superseded-section replacements (U1–U11).** Land as a single PR per supersession. Each requires a judgement call about how much prose to keep as a summary; review per item. U1+U2+U3 are the highest-value (they shrink `02_Core_Logic.md` by ~50 lines and cross-ref the per-platform specs that are now authoritative).
5. **Phase E — prose-to-table conversions (T1–T16).** Land as a single PR per file. Each is independent. T1 (Production Gate matrix) and T8 (EC-* entries) are the highest-value; they each shrink ~100+ lines.
6. **Phase F — lint rollout (L1–L5).** Land last, after Phases A–E are merged. The lint must ship with the ALLOWLIST pre-populated to match the post-dedup tree; otherwise it will fail on every pre-existing structural duplicate.

**Do not skip Phase A.** The stale-ref fixes are the foundation: an agent executing Phase B–E will be reading the cited sections to write the cross-ref replacements, and a stale ref will send them to the wrong section.

### 9.2 Estimated Line-Count Savings

If every TODO in §9 is executed, the planning tree shrinks by approximately:

- Phase A (stale refs): 0 lines net (string replacements).
- Phase B (P1 dedup): ~430 lines removed (R1: ~390, R2: ~35, R11: ~5).
- Phase C (P2 dedup): ~120 lines removed (13 findings × ~10 lines average restatement → one-line cross-ref).
- Phase D (superseded sections): ~150 lines removed (U1–U3: ~50 from `02_Core_Logic.md`; U4–U8: ~80 from `00_Vision`, `AGENTS.md`, `03_User_Flows`, `15_Future_Roadmap`; U9–U11: ~20 from mockup preambles).
- Phase E (prose-to-table): ~400 lines removed (T1: ~60; T8: ~100; T11: ~80; T7: ~100; others: ~60).
- **Total: ~1,100 lines removed from a ~57,700-line tree (~1.9% reduction).** The value is not the line count; it is the **single canonical home per topic** that the dedup establishes, which eliminates the drift risk that the audit was commissioned to address.

### Lint rollout (§8)

- [ ] **TODO L1** — Write `tools/no-duplicate-sections.test.ts` per the sketch in §8.
- [ ] **TODO L2** — Add it to the CI gate in `deployment/05_CI_CD_GitHub_Actions.md` (the lint job).
- [ ] **TODO L3** — Run the lint against the current tree; add every pre-existing duplicate to the ALLOWLIST with a comment explaining why it is structural. (The current ALLOWLIST in §8 is the starting set; the lint run will surface any others.)
- [ ] **TODO L4** — Write `tools/no-duplicate-anti-pattern-rows.test.ts` (companion lint enforcing R11).
- [ ] **TODO L5** — Add a `## Spec ref` to the lint's PR citing this file (`22_Redundancy_Audit.md` §8).

---

## 10. Cross-References

This file audits every other planning doc; it does not introduce new rules. The cross-references below are the docs this file most directly governs the cleanliness of, and the reading-order position of this file.

- `AGENTS.md` §0.3 (reading order) — this file is read AFTER the core specs (`00`–`15`) and the cross-platform infra specs (`16`–`20`), when an agent needs to resolve a contradiction or decide where a new section should live. It is the **cleanliness contract**, not a spec.
- `AGENTS.md` §4 (spec hierarchy) — this file sits alongside `16`–`20` as a cross-cutting meta-spec. It does not override any principle in `01_Product_Principles.md`; it prescribes where each principle is *stated canonically*.
- `13_UI_Guidelines.md` §20 — the ASCII Art Conventions that the §2 R1 dedup targets. After dedup, every file's mockup preamble is a one-liner pointing here.
- `12_Business_Rules.md` §6 (BR-LED-*) — the canonical home for the ledger rule IDs that §2 R9 dedup targets.
- `16_Platform_Delivery_Sequence.md` §3–§6 — the canonical home for the Production Gate definitions that §2 R4 dedup targets.
- `17_API_Gateway_System.md` §2.2 — the canonical home for the no-hardcoded-ingress lint that §2 R5 dedup targets.
- `19_Concurrency_and_Testing.md` §2.1 + §2.2 — the canonical home for coverage floors + the never-mock-the-ledger specialisation.
- `00_Vision.md`, `01_Product_Principles.md`, `02_Core_Logic.md`, `10_Security.md`, `11_Data_Model.md`, `14_Edge_Cases.md`, `15_Future_Roadmap.md` — each carries one or more restatements that §2 flags for cross-ref replacement.
- Every per-platform subdir AGENTS.md (`web/AGENTS.md`, `mobile/AGENTS.md`, `desktop/AGENTS.md`, `deployment/AGENTS.md`, `product/AGENTS.md`) — each carries an anti-patterns table that §2 R11 flags for row-level dedup against the master list in top-level `AGENTS.md` §10.
- The 11 stale references in §4 are P1 fixes; the next agent should land them as a single PR before any dedup work, because dedup will rewrite many of the same lines.
- The lint proposed in §8 is the **enforcement mechanism** for this file. Without it, the dedup in §9 will be re-violated within 3 PRs. The lint must ship in the same release as the dedup, or the audit is theatre.

---

## 11. Audit Limitations & Caveats

This audit is a **snapshot** taken on the day the file was written. It has known limitations:

1. **Phrase-grep is keyword-bound.** The 8 canonical phrases the user named (`Five Screens`, `Immutable Ledger`, etc.) were the seed, but the audit also caught near-synonyms (`append-only ledger`, `bioluminescent`, `Production Gate` vs `production gate`). Synonyms the audit did **not** check (e.g. `offline-first` stated as `airplane-mode-safe`, `tenant` stated as `user`) may hide further redundancies. A follow-up audit using semantic similarity (not regex) would catch more.
2. **The stale-ref check is structural, not semantic.** §4 confirms that the cited section number exists and is the right topic. It does **not** confirm that the cited section says what the citing doc claims it says. A semantic check ("does §N actually define the rule the citation claims?") is out of scope for this audit.
3. **The dedup map (§3) is the audit's opinion.** A different auditor might canonise `00_Vision.md` §11.4 as the immutable-ledger home (it is the manifesto) rather than `02_Core_Logic.md` §6 (the engine deep dive). The audit chose the **most specific operational** doc as canonical, not the most poetic. If the team disagrees, the precedence rules in §5 still apply.
4. **The lint in §8 only catches duplicate H2 headings.** It does **not** catch duplicate *paragraphs* (the ASCII Mockup Suite preamble in §2 R1 is a duplicate paragraph under a non-duplicate heading — the lint will not flag it). A paragraph-level similarity lint (e.g. MinHash over sentences) is a future enhancement.
5. **The superseded-section list (§7) is conservative.** A section is listed only if a newer doc unambiguously covers the same content more authoritatively. Borderline cases (e.g. `02_Core_Logic.md` §11 Report Engine vs `18_Microservice_Architecture.md` report-svc — the engine is still in-process in v1.x; the service is v2.x) are not listed because the older doc is still authoritative for v1.x.
6. **The audit does not score the docs.** It does not say "`07_Fees_and_Payments.md` is too long" or "`16_Platform_Delivery_Sequence.md` is too short." Length is a separate concern from redundancy. A doc can be long and non-redundant (it owns its topic fully) or short and redundant (it restates 3 other docs).
7. **The audit was performed by a single agent.** A second pass by a different agent (or a human reviewer) is recommended before the §9 checklist is executed. The §4 stale-ref list is the highest-confidence finding; the §2 redundancy list is medium-confidence (some "re-statements" may be intentional framing for a different audience); the §7 superseded list is the lowest-confidence (it requires a judgement call about which doc is "more authoritative").

---
