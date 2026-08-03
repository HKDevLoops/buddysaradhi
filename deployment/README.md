# deployment/ — Buddysaradhi Omni-Core Release Pipeline Specification

> The cross-cutting release-pipeline package that ties the three platform surfaces — **Web (Vercel)**, **Mobile (EAS)**, **Desktop (Vercel Blob + Tauri Updater)** — into one coherent, agent-operable, semver-disciplined ship rhythm. The other planning directories (`web/`, `mobile/`, `desktop/`) cover platform-specific configuration; this directory owns the **end-to-end story**: how a `git push` becomes a running experience on a tutor's phone, laptop, and browser, on the same day, at the same version, with a verified rollback.

---

## 1. Why this directory exists

Buddysaradhi: Omni-Core is a **three-surface product** (`00_Vision.md` §3, `15_Future_Roadmap.md` v1.x). The web is the primary surface today (`apps/web`, Next.js 16, App Router). Mobile (`apps/mobile`, Expo SDK 51+) and Desktop (`apps/desktop`, Tauri v2 + Rust + Next.js static export) ship in v1.x as parallel surfaces that share `packages/core` (ledger engine) and `packages/shared` (Zod schemas, calc utils). All three must converge on the **same version** at release time, on the **same day**, with the **same changelog**, and they must roll back independently without taking the others down.

The release pipeline is therefore not a "deploy script." It is the **contract between code and user**. If the pipeline breaks, a tutor's livelihood tool is unavailable. If the pipeline drifts across platforms, a tutor on v1.4.2-mobile and v1.4.3-desktop sees two different realities, and the immutable ledger (`12_Business_Rules.md` BR-LED-01, `10_Security.md` §9 LEDGER-1) becomes a lie. This directory specifies that contract in enough detail that a release-engineering agent can execute a launch from `git tag v1.4.0` to "all three surfaces live, monitored, and rolled-back-ready" without ambiguity.

This directory is **cross-cutting**. It does not duplicate what `web/05_Deployment_Vercel.md`, `mobile/05_EAS_Build.md`, `mobile/06_EAS_Update.md`, or `desktop/05_Updater.md` specify. It **coordinates** them: defines the shared version-bump script, the shared Vercel Blob layout, the shared manifest schema, the shared GitHub Actions workflow graph, the shared rollback playbook, and the shared release checklist.

---

## 2. File index — every file in this directory

| # | File | Words (approx.) | Target reader | One-paragraph summary |
|---|------|---------------:|----------------|-----------------------|
| 0 | `README.md` | ~900 | Everyone (start here) | This file. Orient the new release-engineering agent: who reads what, in what order, with a decision tree and the 3-platform pipeline diagram. |
| 1 | `01_Vercel_Hosting.md` | ~2,700 | DevOps / web lead | The Vercel **project + account** view (not the web-only config — that is `web/05_Deployment_Vercel.md`). Covers project setup, domains, env-var matrix, preview/production promotion, free-tier limits, upgrade triggers, Speed Insights, DDoS posture, status page. |
| 2 | `02_Vercel_Blob_Build_Storage.md` | ~2,800 | Release engineer | Vercel Blob as the **artifact registry** for Desktop installers and Mobile side-load APKs. Covers bucket layout, upload workflow, manifest schema, atomic update + promotion, retention, bandwidth budget, access control. |
| 3 | `03_EAS_Build_and_Update_Channels.md` | ~2,700 | Mobile release engineer | EAS as the single mobile build + OTA pipeline (cross-cutting; coordinates with Vercel Blob for APK mirroring and TestFlight for iOS). Covers project init, build profiles, channel strategy, OTA branching, build→submit→OTA flow, billing. |
| 4 | `04_Release_Pipeline.md` | ~3,000 | Release engineer / orchestrator | The **master flow** — semver, release types (PATCH/MINOR/MAJOR), 15-item release checklist, per-platform rollback playbook, hotfix branch strategy. The end-to-end story from `git push` to running on user devices. |
| 5 | `05_CI_CD_GitHub_Actions.md` | ~3,000 | DevOps / CI engineer | The six GitHub Actions workflows (`lint.yml`, `web-deploy.yml`, `eas-build.yml`, `eas-update.yml`, `desktop-build.yml`, `release.yml`) with full YAML, caching, concurrency, secrets matrix, runner budget. |
| 6 | `AGENTS.md` | ~1,900 | Next release-eng agent | Handoff: prime directive, reading order, file map, YAML style, testing protocol, stop-and-ask triggers, glossary, "done" definition. |

> Total target: **~17,000–18,000 words** across the 7 files. Each file is self-contained but cross-references the others by filename and section number, and cross-references the top-level specs (`AGENTS.md` §2 non-negotiables, `12_Business_Rules.md` BR-*, `14_Edge_Cases.md` EC-*, `10_Security.md` LEDGER-/BACKUP-/TELE-, `09_Backup_and_Import_Export.md` BACKUP-*, `15_Future_Roadmap.md` v1.x).

---

## 3. The 3-platform pipeline at a glance

```
                                  git push (tag v1.4.0)
                                            │
                                            ▼
                          ┌─────────────────────────────────────┐
                          │       GitHub Actions orchestrator    │
                          │   (lint.yml → 4 platform pipelines)  │
                          └─────────────────────────────────────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              ▼                             ▼                              ▼
    ┌─────────────────────┐      ┌──────────────────────┐       ┌───────────────────────────┐
    │  WEB (Vercel)        │      │  MOBILE (EAS)         │       │  DESKTOP (Tauri v2)       │
    │                      │      │                       │       │                           │
    │  Push → auto-build   │      │  eas.yml: tag → build │       │  desktop-build.yml:       │
    │  → 90s production    │      │  iOS + Android        │       │  windows/macos/linux      │
    │  → preview per PR    │      │  → TestFlight + Play  │       │  → cargo build --release  │
    │                      │      │  → store review 1–3d  │       │  → sign + notarize        │
    │  Vercel Web Analyt.  │      │  → auto-submit        │       │  → upload to Vercel Blob  │
    │  + Speed Insights    │      │                       │       │  → update manifest JSON   │
    │                      │      │  OTA via eas update:  │       │                           │
    │  Rollback: instant   │      │  push to main → JS    │       │  Auto-update: Tauri       │
    │  (Vercel UI)         │      │  patch → 15-min reach │       │  updater polls manifest   │
    └─────────────────────┘      └──────────────────────┘       └───────────────────────────┘
              │                             │                              │
              │                             ▼                              │
              │                   ┌──────────────────┐                    │
              │                   │  APK mirror to   │                    │
              │                   │  Vercel Blob     │◀───────────────────┘
              │                   │  (sideload hub)  │   installer + manifest
              │                   └──────────────────┘
              │                             │
              └─────────────┬───────────────┘
                            ▼
                ┌────────────────────────┐
                │  Single source:        │
                │  package.json version  │
                │  → tauri.conf.json     │
                │  → app.json            │
                │  → eas.json build #    │
                │  (bun run version:bump)│
                └────────────────────────┘
                            │
                            ▼
                ┌────────────────────────┐
                │  release.yml (manual): │
                │  GitHub Release +      │
                │  changelog + tweet +   │
                │  Sentry release tag    │
                └────────────────────────┘
```

The diagram has three things to internalise:

1. **Vercel is the home for both the Web app and the installer artifacts.** Web = Vercel Next.js hosting; installers = Vercel Blob. One account, one billing surface, one CDN. The same Vercel-hosted site also serves the commercial landing page (`product/README.md` directory), whose Download Hub section consumes the Blob manifest produced by `desktop-build.yml` and `eas-build.yml` (see `product/04_Download_Hub.md` and `web/07_Landing_Page.md §6`).
2. **EAS is the home for mobile builds + OTA.** It produces the binaries that go to TestFlight / Play Console, and it ships JS-only patches over the air without a store review. APKs are mirrored to Vercel Blob for the web download hub (the commercial spec for that hub is `product/04_Download_Hub.md`); iOS IPAs are **never** mirrored publicly (TestFlight only — see `03_EAS_Build_and_Update_Channels.md` §6).
3. **Desktop is fully self-serve via Tauri's updater plugin.** Tauri polls a JSON manifest hosted on Vercel Blob; when the version in the manifest is newer than the installed one, it downloads, verifies signature, installs on next launch. No store review. Rollback = edit the manifest.

---

## 4. Where to start — a decision tree

```
              ┌──────────────────────────────────────────────────────┐
              │  What are you trying to do?                          │
              └──────────────────────────────────────────────────────┘
                                  │
   ┌────────────┬─────────────────┼────────────────┬─────────────────┐
   ▼            ▼                 ▼                ▼                 ▼
"I'm new —  "I need to ship  "I need to add  "A workflow is   "A release went
 onboard me"  a release today"  a new platform  broken / I need  wrong — how do
              "                 or channel"     to add a secret"  I roll back?"
   │            │                 │                │                 │
   ▼            ▼                 ▼                ▼                 ▼
 Read this   Read this README  Read             Read 05_CI_CD_      Read 04_Release_
 README →    README →          01_Vercel_       GitHub_Actions     Pipeline §6
 AGENTS.md   04_Release_       Hosting.md +                         (rollback
 (this dir)  Pipeline.md       03_EAS_Build_                        playbook per
 → 01_Vercel                    and_Update_                          platform)
   _Hosting     → checklist     Channels.md +
                                02_Vercel_Blob
                                  _Build_Storage.md
```

The decision tree always terminates in a single named file with a single named section. If a release-eng agent cannot find their answer in under three jumps, the directory has a documentation bug — open an issue.

---

## 5. The cross-cutting invariants

Every file in this directory respects the 10 non-negotiable rules from `AGENTS.md` §2. The five that most constrain the release pipeline:

1. **No telemetry (Rule 3, AP-10, TELE-1).** Vercel Web Analytics is allowed because it is privacy-respecting, aggregate-only, and does not set cross-site tracking cookies. Sentry is **NOT** deployed in v1 — crash reporting is opt-in, PII-stripped, end-to-end encrypted, and off by default per `10_Security.md` §17. The `release.yml` workflow references a "Sentry release tag" as a **placeholder** for v2 when an opt-in crash-reporting flow is ratified; in v1, that step is a no-op.
2. **No silent failures (Rule 9).** Every GitHub Actions step has `timeout-minutes` and an explicit `name:`. Every workflow has a failure Slack webhook (via Vercel's built-in integration or a simple `curl` to a Discord webhook). No `continue-on-error: true` on a deploy step.
3. **Integer paise, never float (Rule 6, BR-FEE-01).** The version-bump script does not touch money; this rule applies to the build manifest's `version` field — always a string `"1.4.0"`, never a float `1.4`.
4. **No indigo/blue accents (Rule 5, AP-6).** All ASCII diagrams and code snippets in this directory use the bioluminescent palette: Emerald `#00FF9D`, Cyan `#00F0FF`, Flare `#FF5E00`, Amber `#FFB300`, Violet `#B388FF`. The cosmic indigo→violet **canvas** is neutral; accents are bioluminescent.
5. **Backups are AES-256-GCM + Argon2id (Rule 8, BACKUP-1).** The release pipeline never ships a backup file. The `.buddysaradhi` envelope is created on-device by the tutor; we never see it, host it, or touch it. The pipeline's only artifact-storage responsibility is for **installer binaries** and **manifests** — never user data.

---

## 6. How this directory cross-references the rest of `Buddysaradhi_Planning/`

| Top-level spec | How the deployment package respects it |
|---|---|
| `AGENTS.md` §2 (non-negotiables) | Every workflow YAML enforces lint, typecheck, no-telemetry, no-float-money, no-indigo-accent gates before any deploy step. |
| `00_Vision.md` §3 (platforms) | The 3-platform pipeline diagram is the operationalisation of "Web now, Mobile + Desktop in v1.x." |
| `01_Product_Principles.md` P5 (offline-first) | The Tauri updater + EAS OTA must not introduce a hard network dependency at startup — the apps launch offline; the update check is async, non-blocking, and silent on failure. |
| `01_Product_Principles.md` P10 (backups) | The pipeline never touches user backups; installer artifacts are separate from user data. |
| `01_Product_Principles.md` P13 (distribution) | v1.4 ships platform stores + auto-update; this directory specifies the operational mechanics. |
| `09_Backup_and_Import_Export.md` | The `.buddysaradhi` magic bytes (`BSR1`) are referenced in `02_Vercel_Blob_Build_Storage.md` §10 (signed-manifest verification). |
| `10_Security.md` §15 (BACKUP-1) | Pipeline asserts no plaintext user data crosses Vercel Blob. |
| `10_Security.md` §17 (TELE-1) | Sentry step is a no-op placeholder; no analytics SDK in mobile/desktop builds. |
| `12_Business_Rules.md` BR-SEC-02/03/04 | All signing-key rotations require the sensitive-mutation review path (PIN gate equivalent for ops). |
| `14_Edge_Cases.md` EC-AU-02 (silent failures) | Every workflow step is named + timed; failures surface within 60s. |
| `15_Future_Roadmap.md` v1.4 (distribution) | The release pipeline is the operational instantiation of the v1.4 milestone. |
| `product/04_Download_Hub.md` | The commercial download-hub spec — defines the five DownloadCards (Web, macOS, Windows, Android, iOS) whose installer URLs are populated from the Vercel Blob manifest produced by `02_Vercel_Blob_Build_Storage.md` §4 and rendered by `web/07_Landing_Page.md §6`. |
| `product/09_SEO_and_Analytics.md` | The SEO + analytics spec — defines the keyword map, sitemap, robots, canonicals, and the JSON-LD schema; **governs** the Vercel Web Analytics setup referenced in `01_Vercel_Hosting.md` §9.1 and the `no-third-party-SDK` posture enforced by TELE-1. |
| `product/05_Pricing_and_Plans.md` | The pricing-page spec (₹0 / ₹299 / ₹999 tiers) that lives on the Vercel-hosted marketing surface and consumes the same `bom1`-region Edge + ISR caching as the app surface. |

---

## 7. What "done" looks like for the release pipeline itself

The release pipeline is "done" — meaning this directory's specification is complete and an agent can execute a release from it — when **all** are true:

1. All 7 files in this directory exist, are ≥1,800 words (≥2,500 for the numbered files), and cross-reference each other and the top-level specs by filename + section.
2. A new release-engineering agent, given only this directory and a `git tag`, can execute a v1.4.0 release on all three platforms without asking a question.
3. The rollback playbook has been walked through (table-top exercise) for at least one PATCH, one MINOR, and one MAJOR scenario.
4. The secrets matrix in `05_CI_CD_GitHub_Actions.md` §6 lists every secret the workflows need, with its scope (which workflow), its rotation cadence, and its "if leaked, do this" response.
5. The free-tier budget (Vercel + EAS + GitHub Actions) is documented with upgrade triggers — no surprise bills.
6. The worklog has a `---`-delimited entry from Task ID 2-d confirming the package is shipped.

When all six are true, the release pipeline is **live as a specification**. The first actual release that runs through it is the ratification.

---

## 8. Reading order for the next agent

```
1. README.md            (this file — orientation)
2. AGENTS.md            (this directory's handoff — §prime directive, §stop-and-ask)
3. 01_Vercel_Hosting.md (the foundation — Vercel account, env vars, domains)
4. 02_Vercel_Blob_Build_Storage.md (where installers live)
5. 03_EAS_Build_and_Update_Channels.md (where mobile binaries + OTA live)
6. 04_Release_Pipeline.md (the master flow — start here for a release)
7. 05_CI_CD_GitHub_Actions.md (the workflow YAML — what runs on push)
```

Read in this order. The numbered files build on each other: Vercel hosting (1) is the foundation; Blob storage (2) and EAS (3) are siblings that sit on top of it; the release pipeline (4) is the choreography that uses all three; the GitHub Actions (5) are the automation that executes the choreography.

---

## 9. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald / cyan / amber / flare / violet — never hexed in notes per §20.3 rule 6), cross-references canonical (`§*`, `BR-*`, `EC-*`, `AP-*`, `P*`, `TELE-1`, `BACKUP-1`, `LEDGER-1`). Box widths honour §20.3 rule 2 (80–120 for orientation diagrams). The two mockups below visualise the *orientation primitives* — the file-index decision tree (complementing §4 above) and the platform cross-reference map — that a new release-engineering agent reads first to navigate this package. They are the deployment-package equivalents of the `mobile/README.md §7.2-7.3` orientation mockups, scoped to the cross-cutting concerns (Vercel + Blob + EAS + Tauri + GitHub Actions + release.yml).

### 9.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **orientation layer**, not the live-screen layer. The mockups below are *concept diagrams* (decision trees, cross-reference maps) — governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every spec describes its content with a mockup), but they do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single §6.6 rule — *glass for surfaces, neumo for controls, never invert* — applies to the live UI surfaces that the 6 substantive files (`01`–`05` + `AGENTS.md`) reference (the Vercel dashboard deployment card in `01 §15.5`, the DownloadCard downstream of `02 §13.5`, the EAS dashboard update-history card in `03 §12.5`, the release-engineer's checklist console in `04 §12.5`, the GitHub Actions check-run card in `05 §14.5`); this file's job is to feed a new agent the decision tree and the cross-reference map they consume to find the right file.

| Orientation artefact (this file) | Live-screen consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §2 File index | (none — orientation only) | (none) |
| §4 Decision tree | (none — orientation only) | (none) |
| §6 Cross-reference quick table | (none — orientation only) | (none) |
| §9.2 File-index decision tree (below) | (none — orientation only) | (none) |
| §9.3 Platform cross-reference map (below) | (none — orientation only) | (none) |

### 9.2 File-Index Decision Tree

The §4 "Where to start" decision tree rendered as a fuller mockup that includes every task a release-engineering agent might bring to this directory. Every leaf is a file in this directory; every internal node is a question the new agent asks. The tree is exhaustive — there is no deployment task that does not land on exactly one leaf. If a task seems to land on zero leaves or multiple leaves, it is a stop-and-ask trigger (`AGENTS.md` §6).

```
  FILE-INDEX DECISION TREE  (§4, where to start in deployment/)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                                                                                │
  │                  ┌──────────────────────────────────────────────────────┐     │
  │                  │  What is the deployment task?                        │     │
  │                  │  (read top-level AGENTS.md + 01_Product_Principles   │     │
  │                  │   first — every rule applies to deployment verbatim) │     │
  │                  └──────────────────────────────────────────────────────┘     │
  │                                     │                                          │
  │    ┌──────────┬──────────┬─────────┴───────┬────────────┬─────────────┐     │
  │    ▼          ▼          ▼                 ▼            ▼             ▼     │
  │  "I'm new —  "I need to  "I need to add   "A workflow  "A release    "I am the    │
  │   onboard    ship a      a new platform   is broken /  went wrong —   next        │
  │   me"        release     or channel"      I need to    how do I       release-   │
  │              today"                      add a secret" roll back?"    eng agent  │
  │    │          │          │                 │            │             │      │
  │    ▼          ▼          ▼                 ▼            ▼             ▼      │
  │  README →   README →    01_Vercel_       05_CI_CD_    04_Release_    AGENTS.md │
  │  AGENTS.md  04_Release_ Hosting.md +     GitHub_      Pipeline.md    (then     │
  │  (this dir) Pipeline.md 03_EAS_Build_    Actions.md   §6 (rollback  read      │
  │  → 01_Vercel → §5        and_Update_     §10 (secrets playbook per  everything │
  │   _Hosting    (checklist) Channels.md +  matrix) +    platform)      else)      │
  │                + §6       02_Vercel_Blob  AGENTS §6                   + §11     │
  │                (rollback  _Build_         (stop-and-                  (cross-   │
  │                 playbook) Storage.md      ask matrix)                 ref       │
  │                                                                          index)     │
  │                                                                                │
  │  SPECIAL CASES (all are stop-and-ask triggers per AGENTS.md §6):              │
  │                                                                                │
  │   • "I need to add a 7th workflow"            → 05_CI_CD §12 + AGENTS §6       │
  │     trigger #7 (workflow sprawl = stop-and-ask).                              │
  │                                                                                │
  │   • "I need to change the Vercel region from  → 01_Vercel §2.3 + AGENTS §6    │
  │     bom1"                                        trigger #6 (region change).  │
  │                                                                                │
  │   • "I need to shorten the 24-hour soak"      → 02_Vercel_Blob §6.2 +         │
  │                                                  AGENTS §6 trigger #8.       │
  │                                                                                │
  │   • "I need to rotate TAURI_SIGNING_         → 05_CI_CD §10.1 + AGENTS §6     │
  │     PRIVATE_KEY"                                 trigger #5 (key rotation =  │
  │                                                  all desktop apps must       │
  │                                                  reinstall — heaviest        │
  │                                                  rotation in the system).    │
  │                                                                                │
  │   • "I need to bypass CI for an urgent       → STOP. AGENTS §6 trigger #9     │
  │     release"                                     (only the orchestrator).     │
  │                                                                                │
  │   • "I need to use an indigo/blue color"     → STOP. Use Emerald / Cyan /     │
  │                                                  Flare / Amber / Violet      │
  │                                                  only (Rule 5, AP-6).        │
  │                                                                                │
  │   • "I need to ship a MAJOR release"         → 04_Release_Pipeline §3.3 +     │
  │                                                  §10 (table-top drill) +     │
  │                                                  15_Future_Roadmap.md v2.0.  │
  │                                                                                │
  └──────────────────────────────────────────────────────────────────────────────┘
   ↑ The tree is a concept diagram (orientation), not a rendered UI surface —
     no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = the standard paths (the 6 leaves above), amber
     = the special cases (each a stop-and-ask), flare = the hard stops
     (CI bypass, indigo/blue — Rule 5 + AP-6 violations).
   ↑ Cross-refs: §2 (file index), §4 (where to start — decision tree), §6
     (cross-reference table), AGENTS.md §6 (stop-and-ask triggers, all 10),
     01_Product_Principles.md P13 (distribution), Rule 5 (no indigo/blue),
     Rule 9 (no silent failures — every workflow step has timeout-minutes).
```

### 9.3 Platform Cross-Reference Map

The §6 cross-reference quick table rendered as a map of which top-level / sibling / product specs each deployment file cites. This is the "where does this package reach out to?" view — every arrow is a citation that must stay canonical. The map is the audit artefact for stale cross-references: if a top-level spec ID changes, this map shows which deployment files must update.

```
  PLATFORM CROSS-REFERENCE MAP  (§6, which specs each deployment file cites)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                                                                                │
  │   TOP-LEVEL SPECS  (cited by every deployment file)                           │
  │   ┌────────────────────────────────────────┐                                  │
  │   │  00_Vision.md §3 (platforms)            │ ← README §1, 01 §1, 03 §1,      │
  │   │                                          │   04 §1, AGENTS §0              │
  │   │  01_Product_Principles.md P5, P10,      │ ← README §5, 01 §1, 04 §1,     │
  │   │   P13, P15                               │   AGENTS §0                    │
  │   │  09_Backup_and_Import_Export.md §6,§11  │ ← 02 §10, 04 §6.5              │
  │   │  10_Security.md §2.1,§2.2,§8,§15,§17    │ ← 01 §4, 02 §10, 04 §6.5,     │
  │   │   (BACKUP-1, TELE-1)                     │   05 §10, AGENTS §0            │
  │   │  11_Data_Model.md §1 (Turso)             │ ← 01 §9.3 (no Postgres),       │
  │   │                                          │   01 §15.2 (request path)      │
  │   │  12_Business_Rules.md BR-SEC-02/03/04/   │ ← 01 §4.2, 02 §9.3, 03 §11,   │
  │   │   07/08, BR-SYN-01/02, BR-LED-01,        │   04 §6.5, 05 §10, AGENTS §11 │
  │   │   BR-M-01, BR-ONBOARD-1                  │                                │
  │   │  13_UI_Guidelines.md §5.5,§6.6,§20       │ ← every file's §N ASCII Art    │
  │   │   (glass + neumo + ASCII conventions)    │   Mockup Suite section         │
  │   │  14_Edge_Cases.md EC-M-02, EC-M-03       │ ← 02 §11, 04 §3.3 + §6.5,     │
  │   │   (migration + downgrade)                │   03 §12.4, AGENTS §11         │
  │   │  15_Future_Roadmap.md v1.x, v2.0         │ ← README §1, 01 §1, 03 §1,    │
  │   │                                          │   04 §3.3, AGENTS §0           │
  │   │  AGENTS.md (top-level) §0–§17            │ ← deployment AGENTS is the     │
  │   │                                          │   supplement                   │
  │   └────────────────────────────────────────┘                                  │
  │                                                                                │
  │   PRODUCT/ SPECS  (cited by hosting + blob + EAS files)                       │
  │   ┌────────────────────────────────────────┐                                  │
  │   │  product/04_Download_Hub.md            │ ← 02 §9.1 + §13.5, 03 §6.2       │
  │   │  product/05_Pricing_and_Plans.md       │ ← README §6, 01 §13              │
  │   │  product/09_SEO_and_Analytics.md       │ ← 01 §9.1 + §13, README §6       │
  │   └────────────────────────────────────────┘                                  │
  │                                                                                │
  │   SIBLING PACKAGE SPECS  (parallel planning packages)                         │
  │   ┌────────────────────────────────────────┐                                  │
  │   │  web/05_Deployment_Vercel.md           │ ← 01 §2.3 + §13                  │
  │   │  web/06_Build_and_Release.md           │ ← 02 §9.1                        │
  │   │  web/07_Landing_Page.md §6             │ ← 02 §9.1 + §13.5, 01 §13        │
  │   │  mobile/05_EAS_Build.md                │ ← 03 §1 (mobile-specific config) │
  │   │  mobile/06_EAS_Update.md               │ ← 03 §1 (OTA runtime behaviour)  │
  │   │  desktop/05_Updater.md                 │ ← 02 §1 + §4 (Tauri updater)     │
  │   │  desktop/04_Code_Signing.md            │ ← 02 §9.4 (signatures)           │
  │   └────────────────────────────────────────┘                                  │
  │                                                                                │
  │  AUDIT RULE:                                                                   │
  │   ↑ If a top-level spec ID changes (e.g., BR-LED-01 → BR-LED-XX), this map    │
  │     shows which deployment files must update.                                  │
  │   ↑ The map is the contract that the worklog's "Stale cross-refs fixed"       │
  │     count is measured against.                                                 │
  │   ↑ Constraint: DO NOT change any BR-*, EC-*, AP-*, P-* IDs (task brief).     │
  │                                                                                │
  └──────────────────────────────────────────────────────────────────────────────┘
   ↑ The map is a concept diagram (orientation), not a rendered UI surface —
     no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = the live top-level specs cited throughout,
     cyan = the product/ specs (commercial WHAT — consumed by hosting +
     blob + EAS), violet = the sibling package specs (parallel planning
     packages — the deployment package coordinates with each).
   ↑ Cross-refs: §6 (cross-reference table), AGENTS.md §2 (file map),
     §11 (cross-reference index — the canonical citation list), every
     deployment file's §N ASCII Art Mockup Suite section (which cites
     13_UI_Guidelines.md §5.5 + §6.6 + §20 as the design-system authority).
```

### 9.4 References (External Design Authorities)

The mockups and the orientation primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the file-index decision tree or the platform cross-reference map.

- **Vercel docs** — *Project setup, Edge Network, Blob, Cron, Web Analytics, Speed Insights*. The §9.2 file-index decision tree's "I need to ship a release today" leaf follows Vercel's project-setup documentation (the foundation is hosting; everything else sits on top).
- **GitHub Actions docs** — *Workflow syntax, triggers, concurrency*. The §9.2 "a workflow is broken / I need to add a secret" leaf follows GitHub Actions's workflow + secrets documentation.
- **Expo EAS docs** — *Build profiles, channels, OTA updates*. The §9.2 "I need to add a new platform or channel" leaf follows EAS's profile + channel documentation.
- **Tauri docs** — *Updater plugin, signing keys, manifest schema*. The §9.2 "I need to rotate TAURI_SIGNING_PRIVATE_KEY" special case follows Tauri's signing-key documentation (the heaviest rotation in the system).
- **Smashing Magazine** — *Cross-cutting release-pipeline spec packages*. The §2 file-index (one paragraph per file, reading order not alphabetical) + the §9.2 decision tree follow Smashing's release-pipeline-spec-package research.
- **CSS-Tricks** — *Monorepo structure for cross-platform release pipelines*. The §6 cross-reference table + the §9.3 platform cross-reference map follow CSS-Tricks's monorepo-cross-reference primer.
- **Nielsen Norman Group** — *Information architecture for developer docs*. The §4 decision tree + the §9.2 file-index decision tree follow NN/g's developer-doc IA research (every task lands on exactly one leaf).

---

*This directory is the operational contract between Buddysaradhi code and the tutor's device. Treat it with the same gravity as `12_Business_Rules.md` treats the ledger. A broken release pipeline is a broken promise to every tutor who depends on the app at 7 AM on a Monday.*
