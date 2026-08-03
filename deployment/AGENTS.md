# AGENTS.md — Deployment Package Handoff Directive

> Read this file first when working in `Buddysaradhi_Planning/deployment/`. It governs every release-engineering agent operating on the Buddysaradhi release pipeline. The release pipeline is the contract between code and users — never break it. If a workflow is broken, fix it before merging any feature. A broken pipeline is a broken promise to every tutor who depends on the app at 7 AM on a Monday.

---

## 0. Prime Directive

> **The release pipeline is the contract between code and user. A `git push` that cannot reach a tutor's device — because a workflow is broken, a secret is mis-scoped, a manifest is corrupt, or a rollback path is unverified — is a violation of that contract. Fix the pipeline before you ship the feature.**

The pipeline is not a "deploy script." It is the **operationalisation of P13 (Distribution)** from `01_Product_Principles.md`. The pipeline takes the immutable ledger, the offline-first sync, the AES-256-GCM backup envelope, and the bioluminescent UI, and **delivers them** to a tutor's phone, laptop, and browser. If the pipeline fails, the tutor's livelihood tool is unavailable, and every other principle is moot.

### 0.0 Platform Sequencing — Pipelines Respect the Delivery Order

> **Read `../16_Platform_Delivery_Sequence.md` before touching any workflow.** The release pipeline serves three platforms that ship **serially** — web → production → mobile → production → desktop → production. A workflow that ships a locked platform is a broken pipeline.

As the deployment/release-engineering agent, you are **cross-platform by charter** but you do NOT write app code. The boundary rules:

- **You may edit:** `.github/workflows/*`, `buddysaradhi_Planning/deployment/*.md`, the Caddyfile / gateway deployment config, append-only `worklog.md`.
- **You may NOT edit:** app code under `apps/web/`, `apps/mobile/`, `apps/desktop/`, or `src-tauri/`. A pipeline bug caused by app code is filed as `BUG-<PLATFORM>-*` for that platform's agent.
- **A release workflow for platform P must be gated on P's Production Gate sign-off.** The web release workflow (`05_CI_CD_GitHub_Actions.md`) may run from day one. The EAS mobile workflow (`03_EAS_Build_and_Update_Channels.md`) must `needs: web-prod-gate` (or be manually dispatchable only after the worklog carries `WEB-PROD-GATE`). The desktop notarise/sign workflow (`desktop/04_Code_Signing.md`, `desktop/06_Installers.md`) must likewise wait on `MOBILE-PROD-GATE`. Shipping a locked platform's binary is a release-engineering P0.
- **Contracts are pinned** (`../17_API_Gateway_System.md` §2.1); a deploy that bumps the contract tag is a versioned migration, not a silent push.
- **Check the status block** at the top of `/home/z/my-project/worklog.md` before enabling/disabling a platform's release channel.

The pipeline is the last mile of serial delivery: it must not let a locked platform escape to users.

### 0.1 The Spec → Workflow → Test Loop

Every non-trivial pipeline change follows this loop, in order:

1. **Spec.** Read or write the spec section in `deployment/` that covers the change. If writing, cite the principle (`01_Product_Principles.md`) that authorises the change and the failure mode (`14_Edge_Cases.md`) it must handle.
2. **Workflow.** Implement against the spec. Every workflow YAML change cites the spec section (per §5 below).
3. **Test.** Verify the workflow on a branch via `workflow_dispatch`. A workflow that has not been run on a branch is a workflow that breaks the next release.

If the workflow diverges from the spec, the spec wins — *unless* the spec is wrong, in which case you amend the spec first, get the amendment reviewed, and only then change the workflow.

### 0.2 The No-Orphan-Workflow Rule

Every workflow, every job, every step maps to a named spec section in this directory. A workflow step that maps to nothing gets deleted. When you add a new step, the first line of its `name:` field names the spec it implements — e.g. `name: "Upload to Vercel Blob (deployment/02_Vercel_Blob_Build_Storage.md §3.2)"`. When a reviewer asks "what spec is this step for?" and you cannot answer in one sentence, the answer is "delete it and start over."

---

## 1. Reading Order

Before touching any workflow or pipeline config, read in this order:

1. **`AGENTS.md`** (this file) — the operating manual.
2. **`README.md`** (this directory) — orientation + file index + 3-platform pipeline diagram.
3. **`01_Vercel_Hosting.md`** — the foundation: Vercel account, env vars, domains.
4. **`04_Release_Pipeline.md`** — the master flow: semver, release types, checklist, rollback.
5. **`02_Vercel_Blob_Build_Storage.md`** — where installers live: bucket layout, manifest schema.
6. **`03_EAS_Build_and_Update_Channels.md`** — where mobile binaries + OTA live: channels, build profiles.
7. **`05_CI_CD_GitHub_Actions.md`** — the workflow YAML: 6 workflows, caching, secrets.
8. **Top-level `AGENTS.md`** — the 10 non-negotiable rules (especially Rule 3 no-telemetry, Rule 9 no-silent-failures, Rule 5 no-indigo/blue).
9. **Top-level `12_Business_Rules.md`** §BR-SEC (sensitive-mutation PIN gate — applies to signing-key rotations).
10. **Top-level `10_Security.md`** §17 (TELE-1 — no analytics SDK in v1).

If you skip step 1–7, you will mis-configure the pipeline. If you skip step 8–10, you will violate a non-negotiable.

---

## 2. File Map — what each file in this directory governs

| File in `deployment/` | Governs (in the repo) | Audience |
|---|---|---|
| `README.md` | (this directory's orientation) | Every agent — first read |
| `01_Vercel_Hosting.md` | The Vercel project at `vercel.com/dashboard/buddysaradhi`; the `vercel.json` (with `web/05_Deployment_Vercel.md`); the env vars in Vercel Project Settings; the `status.buddysaradhi.app` Statuspage | DevOps / web lead |
| `02_Vercel_Blob_Build_Storage.md` | The `buddysaradhi-releases/` Blob namespace; `apps/web/server/blob-upload.ts`; `apps/web/server/blob-manifest.ts`; `scripts/blob-upload.mjs`; `scripts/build-manifest.mjs`; `scripts/verify-manifest.mjs`; `scripts/promote-manifest.mjs` | Release engineer |
| `03_EAS_Build_and_Update_Channels.md` | `apps/mobile/eas.json`; `apps/mobile/app.json` (`expo.ios.buildNumber`, `expo.android.versionCode`); the Expo project at `expo.dev/accounts/buddysaradhi`; the TestFlight + Play Internal Testing groups | Mobile release engineer |
| `04_Release_Pipeline.md` | `scripts/version-bump.ts`; `scripts/version-check.ts`; `Buddysaradhi_Planning/deployment/CHANGELOG.md`; the release checklist process | Release engineer / orchestrator |
| `05_CI_CD_GitHub_Actions.md` | `.github/workflows/{lint,web-deploy,eas-build,eas-update,desktop-build,release}.yml`; `.github/actions/agent-browser-smoke/action.yml`; the GitHub Actions secrets + variables; the runner budget | DevOps / CI engineer |
| `AGENTS.md` (this file) | (this directory's handoff) | Next release-eng agent |

### 2.1 What this directory does NOT govern

| Topic | Where it lives |
|---|---|
| Next.js build configuration (`next.config.ts`) | `apps/web/next.config.ts` + `web/05_Deployment_Vercel.md` |
| Tauri capabilities + IPC allowlist | `apps/desktop/src-tauri/tauri.conf.json` + `desktop/05_Updater.md` |
| EAS runtime OTA behaviour (`expo-updates` config) | `apps/mobile/app.json` + `mobile/06_EAS_Update.md` |
| Supabase Edge Function (`provision-db`) | `supabase/functions/provision-db/` + `10_Security.md` §2.1 |
| Turso per-user DB schema + migrations | `migrations/` + `11_Data_Model.md` |
| Web `/download` route UI | `apps/web/app/download/` + `web/06_Build_and_Release.md` |
| Mobile `/Settings/Diagnostics` view | `apps/mobile/src/screens/Settings/` + `mobile/07_Settings.md` |

If a change touches one of these, read the relevant sibling spec first, then come back to this directory for the cross-cutting impact.

---

## 3. Code Style — YAML + JSON

### 3.1 YAML (GitHub Actions workflows)

- **2-space indent.** No tabs.
- **Alphabetical keys** within a mapping, where order does not matter semantically. (Within `steps:`, order matters — preserve intent there.)
- **Explicit `name:` on every step.** No anonymous steps. The `name` field is what shows in the Actions UI; an anonymous step shows as `Run <command>` and is unreviewable in a long log.
- **`timeout-minutes` on every job and every long-running step.** A step without a timeout can hang indefinitely.
- **`if:` conditions on one line.** Multi-line `if:` is hard to read; if the condition is complex, extract a job output and reference it.
- **Quotes around strings that contain special characters** (`${{ ... }}`, `:`, `#`). GitHub Actions YAML parser is strict; bare strings with `:` are mis-parsed as mappings.
- **Comments cite the spec.** Every workflow file starts with `# Implements: deployment/05_CI_CD_GitHub_Actions.md §N — <name>`. Every non-obvious step has a `# See: <spec>` comment.

### 3.2 JSON (`eas.json`, `app.json`, `tauri.conf.json`, manifest)

- **2-space indent.** (Matching the YAML.)
- **Alphabetical keys** within objects, where order does not matter semantically. (Within `platforms` in the manifest, the order is alphabetical: `darwin-aarch64`, `darwin-universal`, `linux-x86_64`, `windows-x86_64`.)
- **No trailing commas.** JSON strict mode.
- **No comments.** JSON does not support comments; if you need to explain a field, do it in the spec, not in the JSON.
- **Versions are strings, not numbers.** `"1.4.0"` not `1.4` (which would parse as `1.4` float and lose the trailing `.0`).

### 3.3 The "no indigo/blue" rule (Rule 5 from top-level `AGENTS.md`)

This directory's ASCII diagrams and code snippets use only the bioluminescent palette:

- Emerald `#00FF9D` — success, "live", "verified"
- Cyan `#00F0FF` — info, "in progress", "monitoring"
- Flare `#FF5E00` — destructive, "rollback", "alert"
- Amber `#FFB300` — warning, "degraded", "soak"
- Violet `#B388FF` — accent, "optional", "v2"

No indigo (`#4F46E5`, `#6366F1`) or blue (`#3B82F6`, `#2563EB`) as a primary accent. The cosmic indigo→violet **canvas** is neutral; accents are bioluminescent. This applies to the Statuspage color scheme (`01_Vercel_Hosting.md` §11.1), the changelog badges, and any UI in the `/download` hub that this directory influences.

---

## 4. Testing Protocol

Every workflow change must run on a branch first, then merge. The protocol:

### 4.1 The on-branch test

1. Branch: `chore/ci/<change-name>` from `main`.
2. Make the workflow change.
3. Push the branch.
4. In the Actions tab, find the workflow. If it has `workflow_dispatch`, click "Run workflow" and select the branch.
5. If it does not have `workflow_dispatch` (e.g., `lint.yml`), open a draft PR to trigger the `pull_request` event.
6. Watch the run. Verify every step succeeds (or fails intentionally, if testing a failure path).
7. If the run fails, fix and re-push. Do not merge until the on-branch run is green.

### 4.2 The "test the rollback path" drill

For changes to `desktop-build.yml`, `eas-build.yml`, `release.yml`, or `eas-update.yml`, the on-branch test must include **rolling back the change**:

- For `desktop-build.yml`: after a successful build, edit the manifest back to the prior version (simulating the §6.4 rollback in `04_Release_Pipeline.md`). Verify the manifest is still valid.
- For `eas-build.yml`: after a successful build, run `eas update --branch staging --republish <prior-build-id>` (simulating the §6.2 rollback).
- For `release.yml`: after a successful dispatch, verify the GitHub Release can be deleted (simulating a "release was wrong" rollback).
- For `eas-update.yml`: after a successful OTA push, run the `--republish` rollback.

A workflow whose rollback path is untested is a workflow whose rollback will fail in production.

### 4.3 The "first release" table-top

Before the first production release using these workflows, the release-engineering agent runs a full table-top exercise (`04_Release_Pipeline.md` §10). The exercise is a release-candidate (e.g., `v1.4.0-rc.1`) cut from `main`, walked through every checklist item, with every rollback playbook triggered at least once.

The table-top is **non-negotiable** for the first release. Subsequent releases can skip it if the agent has run one in the last 90 days.

---

## 5. Commit + PR Conventions

### 5.1 Conventional Commits (extends top-level `AGENTS.md` §5.1)

Format: `type(scope): summary`

- **type** ∈ `feat | fix | docs | refactor | test | chore | perf | sec`
- **scope** for this directory ∈ `ci | vercel | blob | eas | tauri | release | version`
- **summary** = imperative, lowercase, ≤72 chars, no period

Examples:

```
chore(ci): add timeout-minutes to eas-build wait-and-mirror job
fix(vercel): scope BLOB_READ_WRITE_TOKEN to production+preview only
feat(release): add Twitter announcement step to release.yml
docs(deployment): expand rollback playbook for MAJOR releases
sec(tauri): rotate TAURI_SIGNING_PRIVATE_KEY (annual rotation)
chore(version): bump to 1.4.0
```

### 5.2 PR Description Template

```markdown
## What changed
<one-paragraph summary of the workflow / spec change>

## Why
<the operational pain or the spec gap>

## Spec ref
Implements: `deployment/05_CI_CD_GitHub_Actions.md` §4 — eas-build.yml
Cross-ref: `04_Release_Pipeline.md` §3.2 — MINOR release flow
Principle: P13 (Distribution)
Edge cases: EC-AU-02 (silent failure — every step has timeout-minutes)

## Risk
<blast radius if this is wrong; pipeline? signing key? production deploy?>

## Test plan
- [ ] On-branch `workflow_dispatch` run succeeds
- [ ] Rollback path tested (§4.2)
- [ ] No new secret added without §10 matrix update
- [ ] Lint + typecheck pass on the repo
- [ ] Agent Browser smoke (if web-affecting): <URL> renders, sticky footer behaves
```

### 5.3 Reviewer Rules

| Change type | Reviewers required |
|---|---|
| Touches `TAURI_SIGNING_PRIVATE_KEY` handling or any signing key rotation | 2, including one security reviewer |
| Touches `release.yml` (the manual dispatch) | 2, including the orchestrator |
| Touches `desktop-build.yml` signing / notarization steps | 2, including one release-engineering reviewer |
| Touches the version-bump script (`scripts/version-bump.ts`) | 2 (per `04_Release_Pipeline.md` §2.4) |
| Touches a rollback playbook (`04_Release_Pipeline.md` §6) | 2, including the orchestrator |
| <300 lines, no signing/release/version touch | 1 |
| >500 lines | 2 + flag in PR description for human review |

---

## 6. Stop-and-Ask Triggers

The following situations require a pause and human review **before** the PR is opened. An autonomous agent MUST NOT proceed unilaterally.

| # | Trigger | Why sensitive | Who reviews |
|---|---|---|---|
| 1 | Adding a **new secret** to the GitHub Actions secrets | A new secret is a new attack surface; an undocumented secret is an unmanaged secret | Security reviewer + the orchestrator |
| 2 | Adding a **new third-party service** (e.g., Sentry, PostHog, a new CDN) | Violates `AGENTS.md` Rule 3 (no telemetry) or Rule 2 (no network calls) if not in the allowlist | Security reviewer + the orchestrator |
| 3 | Changing the **version-bump script** (`scripts/version-bump.ts`) | The script syncs versions across 8 files; a bug causes cross-platform version drift | 2 release-engineering reviewers |
| 4 | Changing the **rollback strategy** for any surface | A rollback change that is wrong leaves the system un-rollbackable | The orchestrator |
| 5 | **Rotating the `TAURI_SIGNING_PRIVATE_KEY`** | Forces all installed desktop apps to manually reinstall (§10.1 in `05_CI_CD_GitHub_Actions.md`) | The orchestrator + a security reviewer |
| 6 | **Changing the Vercel region** from `bom1` | Affects p50 latency for the v1 user base; a wrong region is a 200ms regression | The orchestrator |
| 7 | **Adding a 7th workflow** to `.github/workflows/` (the 6 in `05_CI_CD_GitHub_Actions.md` §1 are the canonical set) | Workflow sprawl is how pipelines become unmaintainable | The orchestrator |
| 8 | **Changing the 24-hour soak** to <24 hours (or <1 hour for hotfixes) | Reduces the safety window between staging and stable | The orchestrator |
| 9 | **Bypassing CI** for an "urgent" release | CI is the gate; urgency is not a bypass reason | The orchestrator (and only the orchestrator) |
| 10 | Any change that touches >500 lines of workflow YAML | Large workflow PRs hide bugs | 2 reviewers + flag in PR description |

### 6.1 What "Stop and Ask" looks like

1. Stop coding. Commit what you have with `chore(wip): <what> — pending human review`.
2. Open a draft PR with the `## Spec ref` and `## Risk` blocks filled in, even if incomplete.
3. In `worklog.md`, note: `BLOCKED on human review: <trigger #>`.
4. Return control to the orchestrator with a clear request.

---

## 7. Agent Hygiene (extends top-level `AGENTS.md` §9)

1. **Keep workflow PRs small.** <300 lines per PR. A 600-line workflow PR is two PRs.
2. **Run `bun run lint` before every commit** (the repo-wide lint — catches TypeScript + design-system issues that might affect the build).
3. **Never commit a secret.** All secrets are GitHub Actions secrets. If you accidentally commit a secret, rotate it — do not just delete the line.
4. **Update the spec if the workflow diverges.** Spec drift is tech debt with a longer half-life than code debt.
5. **Update `worklog.md` after each meaningful change.** Append a `---`-delimited section with Task ID, Agent, Task, Work Log, Stage Summary.
6. **Use TodoRead / TodoWrite for multi-step tasks.** A release with ≥3 steps gets a todo list.
7. **Cite the spec in every PR's `## Spec ref` block.** (See §5.2.)
8. **No orphan workflow steps.** (See §0.2.)
9. **Verify the on-branch workflow run before merging.** (See §4.1.)
10. **Report back.** Files changed, verification result, next recommended task.

### 7.1 The Release-Eng Agent Operating Loop

When a release-engineering agent is working a task:

1. Read `worklog.md` to learn prior context.
2. Read the relevant `deployment/*.md` per §1.
3. Make the smallest correct change.
4. Run `bun run lint` (the repo-wide lint). Fix all errors.
5. Run the workflow on a branch via `workflow_dispatch`. Verify it succeeds.
6. Open a PR with `## Spec ref` citing this directory.
7. After merge, append a `---`-delimited entry to `worklog.md` with Task ID, Agent, Task, Work Log, Stage Summary **and a `State: COMPLETED | PAUSED | BLOCKED` field** (top-level `AGENTS.md` §9.2.2).
8. Report back with: files changed, verification result, next recommended task.

### 7.2 Task-to-Task Transition Protocol (extends top-level `AGENTS.md` §9.2)

Release-engineering agents frequently shift between Vercel hosting work, EAS build/update work, desktop build/signing work, and the cross-cutting release pipeline. Every shift runs the top-level §9.2.2 Close-Out Checklist. **Release-eng-specific shift triggers** (in addition to the top-level §9.2.5 table):
- A `workflow_dispatch` run fails mid-release → close-out the release task as `BLOCKED` with the failed run URL + step in the worklog; do not mark `completed` on a partial release.
- A GitHub Actions secret is found expired/mis-scoped mid-workflow → close-out as `BLOCKED`, rotate the secret, resume.
- A channel/branch mismatch (production EAS update lands on the wrong channel) → close-out as `PAUSED`, fix the channel→branch mapping (`03_EAS_Build_and_Update_Channels.md`), resume.
- A Tauri signing-key rotation trigger fires (§14.3 trigger #5 — the heaviest) → close-out all lighter in-flight release tasks as `PAUSED`, run the full rotation sequence, then resume.
- A rollback is needed mid-release → close-out the forward release as `PAUSED`, execute the rollback (`04_Release_Pipeline.md` §rollback), log it, then decide whether to resume or restart the release.

The `no-orphaned-task.test.ts` lint (§9.2.6) runs in the `webDevReview` cron and fails if a release-eng todo is left `in_progress` with no worklog entry in the last 30 minutes. A release left half-shipped is the most expensive orphan — it survives because the artefact is already on Vercel Blob / TestFlight / the updater manifold.

---

## 8. Anti-Patterns for Release-Eng Agents

| # | Anti-pattern | Correction |
|---|---|---|
| 1 | Editing a workflow on `main` directly | Branch → on-branch test → PR → merge (§4.1) |
| 2 | Skipping `timeout-minutes` on a long-running step | Every job + every long step has `timeout-minutes` (§3.1) |
| 3 | Using `continue-on-error: true` on a deploy step | A deploy that fails must fail the workflow |
| 4 | Hardcoding a secret in YAML | Use `${{ secrets.NAME }}`; never echo, never log |
| 5 | Echo'ing `${{ secrets.* }}` in a `run:` step | GitHub Actions masks secret values in logs, but a `run` step that echo's a secret into a file or env var can leak it. Use env vars: `env: TOKEN: ${{ secrets.TOKEN }}` then reference `$TOKEN` |
| 6 | Pinning a third-party action to a tag (`@v2`) instead of a SHA | Tags can be moved; SHAs cannot. Pin third-party actions to a SHA. |
| 7 | Re-using a build number across versions | iOS `buildNumber` and Android `versionCode` are monotonic (`04_Release_Pipeline.md` §2.1) |
| 8 | Bypassing the 24-hour soak for a non-hotfix | The soak is the contract between CI and the tutor (`02_Vercel_Blob_Build_Storage.md` §6.2) |
| 9 | Shipping an OTA that references a native module the binary lacks | The `js_only` check (`05_CI_CD_GitHub_Actions.md` §6.1) catches this; do not bypass |
| 10 | Mirroring an iOS IPA to Blob | Apple's distribution model forbids it; the `no-ios-blob-upload.test.ts` lint rule blocks it |
| 11 | Editing the version field in `package.json` / `app.json` / `tauri.conf.json` by hand | Use `bun run version:bump` (`04_Release_Pipeline.md` §2.3) |
| 12 | Promoting staging → stable without `workflow_dispatch` | Promotion is a human-in-the-loop action (`02_Vercel_Blob_Build_Storage.md` §6.4) |
| 13 | Using indigo/blue as a primary accent in pipeline UI | Use the bioluminescent palette (Rule 5) |
| 14 | Adding a Sentry / PostHog / Mixpanel SDK to the mobile or desktop build in v1 | TELE-1 forbids it (`10_Security.md` §17) |
| 15 | Skipping the 1-hour post-release monitor | An unmonitored release is a release that fails silently (`04_Release_Pipeline.md` §5, item 14) |
| 16 | Rolling back without a worklog entry | A rollback without a documented reason is an unaccountable mutation (`04_Release_Pipeline.md` §6) |
| 17 | Shipping a MAJOR release without a table-top drill | MAJOR rollbacks are heavy; the drill is the contract (`04_Release_Pipeline.md` §10) |
| 18 | Letting surfaces drift on a MINOR release | Same version, same day, ±24 hours (`04_Release_Pipeline.md` §8.1) |
| 19 | Using `eas build` without `--non-interactive` in CI | Interactive prompts block the workflow |
| 20 | Caching the Cargo registry without `Cargo.lock` hash in the key | A stale cache causes reproducible-build failures |

---

## 9. Glossary

| Term | Definition |
|---|---|
| **Vercel** | The hosting platform for the Buddysaradhi web surface (Next.js 16). Also provides Vercel Blob for installer storage. See `01_Vercel_Hosting.md`. |
| **Vercel Blob** | Vercel's object storage service. Used as Buddysaradhi's installer registry. See `02_Vercel_Blob_Build_Storage.md`. |
| **Vercel Instant Rollback** | Vercel's one-click rollback to a prior production deployment. The primary web-surface rollback mechanism. See `01_Vercel_Hosting.md` §6.2. |
| **EAS (Expo Application Services)** | Expo's cloud build + submit + update service. Used for all Buddysaradhi mobile native builds + OTA pushes. See `03_EAS_Build_and_Update_Channels.md`. |
| **EAS Build** | The cloud build service. Produces `.ipa` (iOS) and `.apk`/`.aab` (Android) binaries. |
| **EAS Update** | The OTA (over-the-air) update service. Pushes JS-only updates to installed apps without a store review. |
| **OTA (Over-The-Air)** | A JS-only update delivered via EAS Update. Reaches all online devices on the channel in ~15 minutes. |
| **TestFlight** | Apple's beta-testing platform. Distributes iOS builds to invited beta testers. See `03_EAS_Build_and_Update_Channels.md` §9.1. |
| **Play Console Internal Testing** | Google's beta-testing platform. Distributes Android builds to a Google Group of invited testers. See §9.2. |
| **CodeSign (Windows)** | The process of signing a `.msi` with a Windows code-signing certificate (PFX) via `signtool`. Proves the installer is from Buddysaradhi, not tampered with. |
| **Notarytool (macOS)** | Apple's notarization service. Submits the `.dmg` to Apple for automated malware scanning; on success, the `.dmg` gets a "notarized" ticket stapled to it. Required for Gatekeeper to allow installation on macOS. |
| **Stapler (macOS)** | The `xcrun stapler staple` command. "Staples" the notarization ticket to the `.dmg` so it works offline (without contacting Apple's servers at install time). Tauri's build process runs this automatically. |
| **AppImage (Linux)** | A self-contained Linux executable format. No installation required; the user downloads, marks executable (`chmod +x`), and runs. Used for the Linux desktop build. |
| **Tauri v2** | The Rust-based desktop app framework. Wraps a Next.js static export in a native webview; provides the updater plugin that polls the manifest. See `desktop/05_Updater.md`. |
| **Tauri Updater** | The `tauri-plugin-updater` plugin. Polls a JSON manifest at a fixed URL; on a newer version, downloads + verifies signature + installs on next launch. |
| **Manifest (Tauri)** | The JSON file at `manifests/desktop-{staging,stable}.json` that the Tauri Updater polls. Contains version, per-platform URLs, signatures, SHA-256s. See `02_Vercel_Blob_Build_Storage.md` §4. |
| **Ed25519 signature** | The signature algorithm used by Tauri's updater. The private key (`TAURI_SIGNING_PRIVATE_KEY`) signs the installer bytes; the public key (compiled into the app) verifies them. |
| **semver (Semantic Versioning)** | The `MAJOR.MINOR.PATCH` versioning scheme. Buddysaradhi uses it with a build number for iOS/Android stores. See `04_Release_Pipeline.md` §2.1. |
| **Build number** | An integer encoded from semver (`MAJOR × 100 + MINOR × 10 + PATCH`). Required by the App Store (`CFBundleVersion`) and Play Store (`versionCode`). |
| **GH Actions matrix** | The `strategy.matrix` field in a GitHub Actions workflow. Runs the job once per matrix entry, in parallel. Used by `desktop-build.yml` to build Windows/macOS/Linux in parallel. |
| **`workflow_dispatch`** | A GitHub Actions trigger that allows manual workflow runs. Used by `release.yml` for the manual promotion gate. |
| **Channel (EAS)** | A named OTA update stream. Buddysaradhi uses three: `development`, `staging`, `production`. See `03_EAS_Build_and_Update_Channels.md` §4. |
| **`--no-wait` (EAS)** | A flag for `eas build` that starts the build and returns immediately, without blocking until completion. Used to free the GH Actions runner. |
| **`--republish` (EAS)** | A flag for `eas update` that re-publishes a prior update as the latest on a channel. Used for OTA rollback. |
| **`--auto-submit` (EAS)** | A flag for `eas build` that automatically runs `eas submit` after a successful build. Pushes to TestFlight + Play Internal. |
| **Soak (staging)** | The 24-hour window between a build's promotion to `desktop-staging.json` and its promotion to `desktop-stable.json`. Catches regressions the manual smoke missed. |
| **Lint gate** | The `lint.yml` workflow that blocks merge on lint/typecheck/unit/integration/a11y failure. See `05_CI_CD_GitHub_Actions.md` §2. |
| **JS-only change** | A change that touches only `.tsx`/`.ts` files in `apps/mobile/src/` and `packages/`. Eligible for OTA; no binary build required. See `05_CI_CD_GitHub_Actions.md` §6.1. |
| **Runner (GH Actions)** | The VM that executes a GitHub Actions job. Linux runners are 1× cost; Windows 2×; macOS 10×. See `05_CI_CD_GitHub_Actions.md` §11. |
| **Hotfix** | A PATCH release cut outside the normal cadence in response to a production bug. Follows the hotfix branch strategy in `04_Release_Pipeline.md` §7. |
| **Table-top drill** | A simulated release exercise that walks through every checklist item + every rollback playbook. Required before the first production release. |

---

## 10. What "Done" Means for the Release Pipeline

A release pipeline change is "done" when **all** are true:

- Lint passes (`bun run lint`).
- Typecheck passes (`bun run typecheck`).
- The on-branch `workflow_dispatch` run succeeds (§4.1).
- The rollback path was tested (§4.2).
- No §6 stop-and-ask trigger fired without a recorded human review.
- The PR cites its spec section (`## Spec ref`).
- `worklog.md` is updated with a `---`-delimited entry.
- The change is verified to not introduce a new telemetry/analytics SDK (Rule 3).
- The change is verified to not introduce indigo/blue as a primary accent (Rule 5).
- The change is verified to not skip the 1-hour post-release monitor (if release-affecting).

> **"It runs green" is never sufficient.** A green workflow run is the floor, not the ceiling. A workflow that runs green but has an untested rollback path is a workflow that will fail in production.

### 10.1 What "Done" means for a release

A release (PATCH / MINOR / MAJOR) is "done" when:

- All three surfaces (Web / Mobile / Desktop) are live at the same version (±24h for store review).
- The 1-hour post-release monitor passed (no rollbacks triggered).
- The GitHub Release is published with the changelog.
- The `worklog.md` has a `---`-delimited entry documenting the release.
- The release tweet is posted (or skipped with a reason).
- Any rollback that was triggered is documented with its reason + the recovery step.

---

## 11. Cross-Reference Index

| Spec in this directory | Primary top-level specs cross-referenced | Primary BR-/EC-/rule IDs referenced |
|---|---|---|
| `README.md` | All `00`–`15` + `AGENTS.md` + `product/04_Download_Hub.md` + `product/09_SEO_and_Analytics.md` + `product/05_Pricing_and_Plans.md` | All (operationally) |
| `01_Vercel_Hosting.md` | `00_Vision.md` §3, `10_Security.md` §2.2 + §17, `12_Business_Rules.md` BR-SEC-02/03/04, `15_Future_Roadmap.md` v1.x, `product/09_SEO_and_Analytics.md` (Vercel Web Analytics governance), `product/05_Pricing_and_Plans.md` (pricing page on the Vercel-hosted site), `web/07_Landing_Page.md` (commercial landing page implementation) | TELE-1, Rule 3 (no telemetry), Rule 9 (no silent failures) |
| `02_Vercel_Blob_Build_Storage.md` | `09_Backup_and_Import_Export.md` §6, `10_Security.md` §15 (BACKUP-1), `14_Edge_Cases.md` EC-M-03, `product/04_Download_Hub.md` (commercial download-hub spec), `web/07_Landing_Page.md §6` (implementation spec for the download hub) | BACKUP-1, LEDGER-1 (immutability — installers are immutable too) |
| `03_EAS_Build_and_Update_Channels.md` | `00_Vision.md` §3, `15_Future_Roadmap.md` v1.x + v3.x, `product/04_Download_Hub.md` (Android DownloadCard surfaces the APK mirror) | Rule 4 (five screens — the `/download` route is a sub-screen, not a 6th) |
| `04_Release_Pipeline.md` | `01_Product_Principles.md` P13, `09_Backup_and_Import_Export.md` §11, `14_Edge_Cases.md` EC-M-02 + EC-M-03, `15_Future_Roadmap.md` v1.x + v2.0 | EC-M-02 (migration fails mid-way), EC-M-03 (downgrade attempt), Rule 6 (integer paise — versions are strings, never floats) |
| `05_CI_CD_GitHub_Actions.md` | `AGENTS.md` §7.4 (CI gate), `10_Security.md` §17 (TELE-1) | Rule 3, Rule 5, Rule 9 |
| `AGENTS.md` (this file) | `AGENTS.md` (top-level) §0–§17 | All (operationally) |

---

## 12. The "next agent" handoff

If you are the next release-engineering agent picking up this directory:

1. **Read `worklog.md`** for the most recent `Task ID: 2-d` entry (this task). Note the file list + word counts + any caveats.
2. **Read this file** (deployment `AGENTS.md`) in full.
3. **Read `README.md`** for the orientation + file index.
4. **Read `04_Release_Pipeline.md`** for the master flow + the 15-item release checklist.
5. **Skim the other 4 numbered files** (`01`, `02`, `03`, `05`) for the parts relevant to your task.
6. **Run `bun run lint`** to verify the repo is clean.
7. **Check the GitHub Actions tab** for any failed workflow runs since the last `worklog.md` entry. If there are failures, investigate before starting new work.
8. **Open a `---`-delimited entry in `worklog.md`** with your Task ID, the work you're starting, and the spec sections you'll touch.

If you find a spec that is wrong (e.g., a workflow YAML example that does not match the actual GitHub Actions schema), **amend the spec first**, then fix the workflow, then update `worklog.md`. Spec drift is tech debt with a longer half-life than code debt.

---

## 13. The Prime Directive, Restated

> **The release pipeline is the contract between code and user. A `git push` that cannot reach a tutor's device — because a workflow is broken, a secret is mis-scoped, a manifest is corrupt, or a rollback path is unverified — is a violation of that contract. Fix the pipeline before you ship the feature.**

Every other rule in this file derives from this one. The pipeline is not a "deploy script"; it is the operationalisation of the tutor's trust. A tutor who installs Buddysaradhi at 7 AM on a Monday trusts that the app will open, the ledger will be intact, the backup will restore. The pipeline is what makes that trust warranted.

When in doubt, ask: *would I ship this pipeline to the maths teacher in Nagpur who has 40 students, three batches, and one laptop?* If the answer is "no," do not ship it.

---

## 14. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald / cyan / amber / flare / violet — never hexed in notes per §20.3 rule 6), cross-references canonical (`§*`, `BR-*`, `EC-*`, `AP-*`, `P*`, `TELE-1`). Box widths honour §20.3 rule 2 (80–120 for flowchart / decision-tree diagrams). The two mockups below visualise the *handoff primitives* — the reading-order flowchart (complementing §1 above) and the stop-and-ask decision tree (complementing §6 above) — that a new release-engineering agent reads first to internalise this file's contract. They are the deployment-AGENTS equivalents of the `mobile/AGENTS.md` orientation mockups, scoped to the cross-cutting release pipeline.

### 14.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **handoff layer**, not the live-screen layer. The mockups below are *concept diagrams* (flowcharts, decision trees) — governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every spec describes its content with a mockup), but they do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single §6.6 rule — *glass for surfaces, neumo for controls, never invert* — applies to the live UI surfaces that the 6 substantive files (`01`–`05` + `README.md`) reference (the Vercel dashboard deployment card in `01 §15.5`, the DownloadCard downstream of `02 §13.5`, the EAS dashboard update-history card in `03 §12.5`, the release-engineer's checklist console in `04 §12.5`, the GitHub Actions check-run card in `05 §14.5`); this file's job is to feed a new agent the reading-order flowchart and the stop-and-ask decision tree they consume to internalise the prime directive.

| Handoff artefact (this file) | Live-screen consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §1 Reading order | (none — orientation only) | (none) |
| §2 File map | (none — orientation only) | (none) |
| §6 Stop-and-ask triggers | (none — orientation only) | (none) |
| §14.2 Reading-order flowchart (below) | (none — orientation only) | (none) |
| §14.3 Stop-and-ask decision tree (below) | (none — orientation only) | (none) |

### 14.2 Reading-Order Flowchart

The §1 reading order rendered as a flowchart that includes the "why each step matters" rationale. The order is non-negotiable: skipping step 1–7 mis-configures the pipeline; skipping step 8–10 violates a non-negotiable. The flowchart is the **single source of truth** for "what do I read first, and why?"

```
  READING-ORDER FLOWCHART  (§1, what to read before touching any workflow)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                                                                                │
  │   ┌──────────────────────────────────────────────────────────────────────┐   │
  │   │  STEP 1: AGENTS.md (this file)                                       │   │
  │   │   ↑ the operating manual — prime directive, reading order, stop-ask  │   │
  │   │   ↑ WHY: skipping this = mis-configured pipeline (no prime directive │   │
  │   │     = no contract between code and user)                             │   │
  │   │   (emerald ✓ — read first, always)                                   │   │
  │   └──────────────────────────────────────────────────────────────────────┘   │
  │                                     │                                          │
  │                                     ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────────┐   │
  │   │  STEP 2: README.md (this directory)                                  │   │
  │   │   ↑ orientation + file index + 3-platform pipeline diagram           │   │
  │   │   ↑ WHY: skipping this = no mental model of the 7-file package       │   │
  │   │   (emerald ✓)                                                        │   │
  │   └──────────────────────────────────────────────────────────────────────┘   │
  │                                     │                                          │
  │                                     ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────────┐   │
  │   │  STEP 3: 01_Vercel_Hosting.md                                        │   │
  │   │   ↑ the foundation — Vercel account, env vars, domains               │   │
  │   │   ↑ WHY: skipping this = no hosting foundation; everything else      │   │
  │   │     (Blob + EAS + release pipeline) sits on top of Vercel            │   │
  │   │   (emerald ✓)                                                        │   │
  │   └──────────────────────────────────────────────────────────────────────┘   │
  │                                     │                                          │
  │                                     ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────────┐   │
  │   │  STEP 4: 04_Release_Pipeline.md                                      │   │
  │   │   ↑ the master flow — semver, release types, 15-item checklist,      │   │
  │   │     rollback playbook                                                │   │
  │   │   ↑ WHY: skipping this = no choreography; the pipeline is the        │   │
  │   │     contract between code and user (P13 distribution)                │   │
  │   │   (emerald ✓)                                                        │   │
  │   └──────────────────────────────────────────────────────────────────────┘   │
  │                                     │                                          │
  │                                     ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────────┐   │
  │   │  STEP 5: 02_Vercel_Blob_Build_Storage.md                             │   │
  │   │   ↑ where installers live — bucket layout, manifest schema, atomic   │   │
  │   │     update + promotion                                               │   │
  │   │   ↑ WHY: skipping this = corrupt manifests, lost installers          │   │
  │   │   (emerald ✓)                                                        │   │
  │   └──────────────────────────────────────────────────────────────────────┘   │
  │                                     │                                          │
  │                                     ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────────┐   │
  │   │  STEP 6: 03_EAS_Build_and_Update_Channels.md                         │   │
  │   │   ↑ where mobile binaries + OTA live — channels, build profiles      │   │
  │   │   ↑ WHY: skipping this = wrong channel, broken OTA, store rejection  │   │
  │   │   (emerald ✓)                                                        │   │
  │   └──────────────────────────────────────────────────────────────────────┘   │
  │                                     │                                          │
  │                                     ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────────┐   │
  │   │  STEP 7: 05_CI_CD_GitHub_Actions.md                                  │   │
  │   │   ↑ the workflow YAML — 6 workflows, caching, secrets, runner budget │   │
  │   │   ↑ WHY: skipping this = broken workflows, hung jobs, leaked secrets │   │
  │   │   (emerald ✓)                                                        │   │
  │   └──────────────────────────────────────────────────────────────────────┘   │
  │                                     │                                          │
  │                                     ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────────┐   │
  │   │  STEP 8: top-level AGENTS.md §0–§17                                  │   │
  │   │   ↑ the 10 non-negotiable rules (especially Rule 3 no-telemetry,     │   │
  │   │     Rule 9 no-silent-failures, Rule 5 no-indigo/blue)                │   │
  │   │   ↑ WHY: skipping this = non-negotiable violation (P0)               │   │
  │   │   (amber — read this AFTER the deployment files, but BEFORE any      │   │
  │   │    workflow change)                                                  │   │
  │   └──────────────────────────────────────────────────────────────────────┘   │
  │                                     │                                          │
  │                                     ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────────┐   │
  │   │  STEP 9: top-level 12_Business_Rules.md §BR-SEC                      │   │
  │   │   ↑ sensitive-mutation PIN gate — applies to signing-key rotations   │   │
  │   │   ↑ WHY: skipping this = unaudited sensitive op (BR-SEC-04 +         │   │
  │   │     BR-SEC-08 — audit_log is the contract)                           │   │
  │   │   (amber)                                                            │   │
  │   └──────────────────────────────────────────────────────────────────────┘   │
  │                                     │                                          │
  │                                     ▼                                          │
  │   ┌──────────────────────────────────────────────────────────────────────┐   │
  │   │  STEP 10: top-level 10_Security.md §17 (TELE-1)                      │   │
  │   │   ↑ no analytics SDK in v1 — Sentry/PostHog/Mixpanel forbidden      │   │
  │   │   ↑ WHY: skipping this = telemetry violation (Rule 3, TELE-1, P0)   │   │
  │   │   (amber)                                                            │   │
  │   └──────────────────────────────────────────────────────────────────────┘   │
  │                                     │                                          │
  │                                     ▼                                          │
  │                            (Now touch the workflow.)                          │
  │                                                                                │
  │  THE RULE (§1, the contract):                                                  │
  │   ↑ Steps 1–7 are the deployment-package orientation. Skipping =               │
  │     mis-configured pipeline.                                                   │
  │   ↑ Steps 8–10 are the top-level non-negotiables. Skipping =                   │
  │     non-negotiable violation.                                                  │
  │   ↑ The order matters — each step builds on the prior.                         │
  │                                                                                │
  └──────────────────────────────────────────────────────────────────────────────┘
   ↑ The flowchart is a concept diagram (orientation), not a rendered UI
     surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = the 7 deployment-package reads (the
     orientation), amber = the 3 top-level non-negotiable reads (the
     constraints), flare = the consequence of skipping (a P0 violation).
   ↑ Cross-refs: §1 (reading order), §0 (prime directive — the contract
     this flowchart operationalises), top-level AGENTS.md §0–§17 (the 10
     non-negotiable rules), 12_Business_Rules.md §BR-SEC (sensitive-
     mutation PIN gate), 10_Security.md §17 (TELE-1 — no analytics SDK),
     Rule 3 (no telemetry), Rule 5 (no indigo/blue), Rule 9 (no silent
     failures), P13 (distribution).
```

### 14.3 Stop-and-Ask Decision Tree

The §6 stop-and-ask triggers rendered as a decision tree that includes the "who reviews" + "why sensitive" for each trigger. The tree is the **single source of truth** for "do I stop and ask, or do I proceed?" Every trigger is a hard stop — an autonomous agent MUST NOT proceed unilaterally.

```
  STOP-AND-ASK DECISION TREE  (§6, when to pause for human review)
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                  │
  │              ┌──────────────────────────────────────────────────────┐             │
  │              │  PROPOSED PIPELINE CHANGE                             │             │
  │              │  (a workflow YAML edit, a new secret, a version-     │             │
  │              │   bump script change, a region change, etc.)         │             │
  │              └──────────────────────────────────────────────────────┘             │
  │                                     │                                            │
  │                                     ▼                                            │
  │              ┌──────────────────────────────────────────────────────┐             │
  │              │  Does the change match any of the 10 stop-and-ask    │             │
  │              │  triggers in §6?                                     │             │
  │              └──────────────────────────────────────────────────────┘             │
  │                                     │                                            │
  │             ┌───────────────────────┴───────────────────────┐                    │
  │             ▼                                               ▼                    │
  │           YES                                               NO                  │
  │             │                                               │                    │
  │             ▼                                               ▼                    │
  │   ┌──────────────────────────────────┐         ┌──────────────────────────────┐  │
  │   │  STOP. Do NOT proceed            │         │  Proceed: branch → on-branch │  │
  │   │  unilaterally.                   │         │  test (§4.1) → PR → merge.   │  │
  │   │                                  │         │  (emerald ✓ — standard path) │  │
  │   │  1. Commit WIP:                  │         └──────────────────────────────┘  │
  │   │     chore(wip): <what> —         │                                            │
  │   │     pending human review         │                                            │
  │   │                                  │                                            │
  │   │  2. Open draft PR with           │                                            │
  │   │     ## Spec ref + ## Risk filled │                                            │
  │   │                                  │                                            │
  │   │  3. worklog.md note:             │                                            │
  │   │     BLOCKED on human review:     │                                            │
  │   │     <trigger #>                  │                                            │
  │   │                                  │                                            │
  │   │  4. Return control to the        │                                            │
  │   │     orchestrator with a clear    │                                            │
  │   │     request.                     │                                            │
  │   │  (flare — hard stop)             │                                            │
  │   └──────────────────────────────────┘                                            │
  │             │                                                                    │
  │             ▼                                                                    │
  │   ┌──────────────────────────────────────────────────────────────────────────┐  │
  │   │  WHICH TRIGGER? (the 10 in §6, each with its reviewer):                  │  │
  │   │                                                                            │  │
  │   │   #1  New secret                → Security reviewer + orchestrator        │  │
  │   │   #2  New third-party service   → Security reviewer + orchestrator        │  │
  │   │       (Sentry, PostHog, new CDN) →   (Rule 3 no-telemetry, TELE-1)        │  │
  │   │   #3  version-bump script change→ 2 release-eng reviewers                 │  │
  │   │   #4  Rollback strategy change  → Orchestrator                            │  │
  │   │   #5  TAURI_SIGNING_PRIVATE_KEY → Orchestrator + security reviewer        │  │
  │   │       rotation                   (heaviest rotation — all desktop apps    │  │
  │   │                                    must reinstall)                        │  │
  │   │   #6  Vercel region change      → Orchestrator                            │  │
  │   │       (bom1 → other)              (p50 latency regression risk)           │  │
  │   │   #7  7th workflow               → Orchestrator                           │  │
  │   │       (workflow sprawl)           (canonical set = 6)                     │  │
  │   │   #8  24-hour soak shortened     → Orchestrator                           │  │
  │   │       (<24h or <1h hotfix)        (the soak is the CI↔tutor contract)     │  │
  │   │   #9  CI bypass for "urgent"     → Orchestrator (ONLY the orchestrator)   │  │
  │   │       release                    (CI is the gate; urgency ≠ bypass)      │  │
  │   │   #10 >500 lines of workflow YAML→ 2 reviewers + flag in PR description   │  │
  │   │       (large PRs hide bugs)      (break into 2 PRs if possible)          │  │
  │   │                                                                            │  │
  │   │  (amber — each trigger has a named reviewer; the agent does NOT           │  │
  │   │   self-approve any of these)                                              │  │
  │   └──────────────────────────────────────────────────────────────────────────┘  │
  │                                                                                  │
  │  THE RULE (§6, the contract):                                                    │
  │   ↑ Stop-and-ask is the contract between autonomous speed and human             │
  │     accountability.                                                              │
  │   ↑ An autonomous agent that proceeds unilaterally on a stop-and-ask            │
  │     trigger has violated the prime directive (§0).                              │
  │   ↑ The worklog.md "BLOCKED on human review: <trigger #>" entry is the          │
  │     audit trail — a stop-and-ask without a worklog entry is an                  │
  │     unaccountable pause.                                                        │
  │                                                                                  │
  └──────────────────────────────────────────────────────────────────────────────────┘
   ↑ The tree is a concept diagram (handoff routing), not a rendered UI
     surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = the standard proceed path (no trigger
     matched), amber = each trigger's named reviewer (the human-in-
     the-loop), flare = the hard stop (do NOT proceed unilaterally).
   ↑ Cross-refs: §0 (prime directive — the contract this tree
     operationalises), §6 (the 10 stop-and-ask triggers), §6.1 (what
     "stop and ask" looks like — the 4-step WIP protocol), §4.1 (the
     on-branch test the standard path requires), §5.2 (the PR description
     template — ## Spec ref + ## Risk), §7.1 (the release-eng agent
     operating loop — step 6 cites the spec in every PR), Rule 3 (no
     telemetry — trigger #2), Rule 9 (no silent failures — every workflow
     step has timeout-minutes), 10_Security.md §17 (TELE-1 — trigger #2),
     05_CI_CD §10.1 (TAURI key rotation — trigger #5).
```

### 14.4 References (External Design Authorities)

The mockups and the handoff primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the reading order, the stop-and-ask triggers, or the prime directive.

- **GitHub Actions docs** — *Workflow change protocol, secrets management, runner security*. The §14.3 stop-and-ask triggers #1, #2, #5, #10 follow GitHub Actions's secrets + workflow-change documentation.
- **Vercel docs** — *Region selection, deployment protection, promotion gates*. The §14.3 trigger #6 (region change = stop-and-ask) follows Vercel's region-selection documentation (p50 latency is the lever).
- **Expo EAS docs** — *Build profile changes, channel re-routing, OTA rollback*. The §14.3 trigger #4 (rollback strategy change = stop-and-ask) follows EAS's OTA-rollback documentation.
- **Tauri docs** — *Signing key rotation, updater plugin, manifest schema*. The §14.3 trigger #5 (TAURI key rotation = the heaviest) follows Tauri's signing-key documentation (rotation forces desktop reinstalls).
- **Smashing Magazine** — *Agent handoff directives, stop-and-ask patterns*. The §14.2 reading-order flowchart + §14.3 stop-and-ask decision tree follow Smashing's agent-handoff-directive research (the prime directive as the contract between autonomous speed and human accountability).
- **CSS-Tricks** — *Reading-order discipline for spec packages*. The §14.2 reading-order flowchart follows CSS-Tricks's spec-package-reading-order primer (each step builds on the prior; the order matters).
- **Nielsen Norman Group** — *Information architecture for developer handoff*. The §14.2 flowchart + §14.3 decision tree follow NN/g's developer-handoff-IA research (every change lands on exactly one path — proceed or stop-and-ask).
- **Shape Up** by Ryan Singer (Basecamp, 2019) — *The "fat-marker" handoff as the contract*. The §0 prime directive + §14.3 stop-and-ask tree follow Shape Up's pitch-level-contract tradition (the handoff is the contract; the workflow change is the execution).

---

*This file is the operating manual for `Buddysaradhi_Planning/deployment/`. It is read first, before any workflow or pipeline config. When this file and a workflow YAML disagree, this file wins — unless this file is wrong, in which case you amend this file first, then the workflow, then the code, then the worklog. The order matters.*
