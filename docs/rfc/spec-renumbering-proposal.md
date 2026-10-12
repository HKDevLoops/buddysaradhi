# Spec Renumbering Proposal — Restoring One Number = One Document (21–26)

**Status:** Draft — Awaiting Owner Ratification (AGENTS.md §8 #6 gated; NOT RATIFIED, NOT EXECUTED)
**Author:** build (opencode)
**Created:** 2026-10-12
**Spec Owners:** Orchestrator + 1 reviewer (AGENTS.md §5.4: any `AGENTS.md` edit needs 2 reviewers + orchestrator sign-off; §8 #6)
**Related Specs:** `AGENTS.md` §0.3 / §17, review packet `docs/rfc/gated-review-packet-phases-1-3-4.md` Phase 1
**Supersedes nothing. Renames nothing yet.** No file is moved and no reference is edited until sign-off.

---

## 1. The collision (verified on the current tree)

`Get-ChildItem` at repo root + `Get-Item` lengths, measured 2026-10-12 (match the review packet's figures exactly):

| Number | File A (bytes) | File B (bytes) |
|---|---|---|
| 21 | `21_Automation_Testing.md` (80,890) | `21_Redis_Caching_Layer.md` (38,275) |
| 22 | `22_Redundancy_Audit.md` (78,267) | `22_Vector_Search_System.md` (35,536) |
| 23 | `23_Complexity_Guarantees.md` (23,937) | `23_Security_Harness_Plan.md` (130,801) |

`00`–`20` are unique (verified via root listing: `00_Vision.md` … `20_3D_Product_Page.md`, one file each). Only 21/22/23 collide — six files, three numbers, two files each, as the packet states.

Why it matters (packet Phase 1, confirmed): `AGENTS.md` §0.3 cites `23_Security_Harness_Plan.md §5` and `22_Redundancy_Audit.md` by number — with two `23_*` files, "`23 §5`" is ambiguous, and `git log --follow` on a number is ambiguous.

---

## 2. Proposed mapping (old → new)

Principle: **the three files `AGENTS.md` §0.3 names keep their numbers** (they are the load-bearing citations: reading-order items 10/11/12 at `AGENTS.md:76,78-79,85,92,96` — read), and the three files nothing outside themselves cites structurally move to 24–26. Reference counts support this split (§3).

| Old (colliding) | New (unique) | Why this one moves / stays |
|---|---|---|
| `21_Automation_Testing.md` | **stays `21_`** | Cited in `AGENTS.md` §0.3 item 10 (`:85`); 25 referencing lines — renaming it maximises churn |
| `21_Redis_Caching_Layer.md` | `24_Redis_Caching_Layer.md` | 16 referencing lines; infra-layer topic sits naturally after `19_Concurrency_and_Testing.md` |
| `22_Redundancy_Audit.md` | **stays `22_`** | Cited in `AGENTS.md` §0.3 item 11 (`:92`) and §17-adjacent dedup map; 21 referencing lines |
| `22_Vector_Search_System.md` | `25_Vector_Search_System.md` | 10 referencing lines (fewest); systems topic pairs with 24 |
| `23_Complexity_Guarantees.md` | `26_Complexity_Guarantees.md` | 13 referencing lines; theory/coda topic closes the sequence |
| `23_Security_Harness_Plan.md` | **stays `23_`** | Cited in `AGENTS.md` §0.3 item 12 (`:96`) and §0.3 (`:78-79`); 48 referencing lines (most-cited of the six) — moving it would maximise churn |

Result: 21, 22, 23, 24, 25, 26 — one number, one document, matching the packet's "Renumber to 24–26" option. Ordering 24→26 is thematic (infra → systems → theory), not chronological; chronological order is unrecoverable and not worth recovering.

---

## 3. Measured reference counts (real numbers, grep-measured 2026-10-12)

### 3.1 Filename references (`NN_Topic_Name` tokens, repo-wide excluding `.git`)

- **124 matching lines across 50 files** (`rg` filename alternation, `--no-heading`, `Measure-Object -Line`).
- Per-file-topic line counts (a line citing two topics counts twice — hence sum 133 > 124):

| Topic token | Lines |
|---|---|
| `21_Automation_Testing` | 25 |
| `21_Redis_Caching` | 16 |
| `22_Redundancy_Audit` | 21 |
| `22_Vector_Search` | 10 |
| `23_Complexity_Guarantees` | 13 |
| `23_Security_Harness` | 48 |

- **Lines needing update under the §2 mapping: 39** (16 + 10 + 13 for the three moved topics; upper bound — multi-match-line overlap UNVERIFIED at the per-line level). Lines citing the three staying topics (25 + 21 + 48 = 94) are untouched.
- `AGENTS.md`: 6 filename-reference lines (`:76,78,79,85,92,96` — all §0.3; §17's index table names no 21/22/23 file — verified by the same grep returning only those 6 lines).
- `worklog.md`: 4 filename-reference lines — **frozen history, NOT rewritten** (worklog is append-only per AGENTS.md §9; the ratifying PR appends a mapping note instead).

### 3.2 Bare section references (`§21` / `§22` / `§23` — ambiguous by construction)

- **45 matching lines across 14 files** (`rg "§\s*(21|22|23)\b"`):

| File | Lines |
|---|---|
| `23_Security_Harness_Plan.md` | 10 |
| `13_UI_Guidelines.md` | 9 |
| `22_Redundancy_Audit.md` | 6 |
| `apps/web/src/components/buddysaradhi/dashboard-client.tsx` | 5 |
| `docs/rfc/security-master.md` | 4 |
| `02_Core_Logic.md` | 2 |
| `web/02_State_and_Data_Flow.md` | 2 |
| `12_Business_Rules.md` | 1 |
| `web/AGENTS.md` | 1 |
| `worklog.md` (frozen — triage only, never rewrite) | 1 |
| `apps/web/src/components/attendance/attendance-grid.tsx` | 1 |
| `apps/web/src/components/attendance/bulk-absent-sheet.tsx` | 1 |
| `apps/web/src/components/settings/settings-client.tsx` | 1 |
| `apps/web/tests/e2e/zz-tmp-attendance-audit.spec.ts` | 1 |

- Which document each of the 45 intends (staying vs moved file) is **UNVERIFIED** — that classification is exactly what the §4 script's triage list is for. No §-ref is rewritten by blind find-and-replace.

### 3.3 What was NOT counted

`git log --follow` history, open PRs, and any refs in untracked local files are outside this measurement (UNVERIFIED). The verification script (§4, check 4) re-runs at merge time so drift between proposal and execution is caught, not assumed away.

---

## 4. Machine-checkable verification plan (the script)

A single script (PowerShell, repo root; runs in CI as the merge gate for the renumber PR) with four checks. Fails closed — any failure blocks the merge:

```powershell
# Check 1 — uniqueness: exactly one file per NN prefix in 00..26.
$nums = Get-ChildItem -Name "[0-9][0-9]_*.md"
$nums | Group-Object { $_.Substring(0,2) } | Where-Object { $_.Count -ne 1 } | ForEach-Object { Write-Error "collision: $($_.Name)" }

# Check 2 — resolution: every NN_Topic token resolves to exactly one existing file.
rg --no-heading -o "[0-9]{2}_[A-Za-z_]+" --glob "*.md" --glob "*.ts" --glob "*.tsx" . |
  ForEach-Object { if (@(Get-ChildItem -Name "$_*.md").Count -ne 1) { Write-Error "unresolved: $_" } }

# Check 3 — triage: emit every bare §21/§22/§23 line with file:line + context for manual classification.
rg --no-heading -n "§\s*(21|22|23)\b" > /tmp/section-ref-triage.txt
# A human marks each line stay/move; the renumber PR may not merge with unmarked lines.

# Check 4 — drift: re-run §§3.1–3.2 counts; fail if they differ from the ratified baseline (§3)
# without an amended triage list.
```

Pass criteria: check 1 clean (26 unique numbers), check 2 zero unresolved, check 3 fully classified with each `move`-marked line rewritten to its §24/25/26 target, check 4 counts match the executed (not proposed) baseline. The script itself is reviewed in the ratifying PR — it is the audit trail that the mechanical pass did not silently invalidate a citation (packet Phase 1 risk statement).

---

## 5. Blast radius (which files contain references — from the 50-file measurement)

| Group | Files | Treatment |
|---|---|---|
| Root specs (self/cross refs) | `13_UI_Guidelines.md`, `16_Platform_Delivery_Sequence.md`, `17_API_Gateway_System.md`, `18_Microservice_Architecture.md`, `19_Concurrency_and_Testing.md` + the six numbered files themselves | Mechanical rename of moved-topic tokens; §-refs per triage list |
| `AGENTS.md` | 1 file, 6 lines (all §0.3) | Hand-edited (constitution file, §8 #6 + §5.4 two-reviewer + orchestrator sign-off) |
| Platform subdirs | `deployment/06_Edge_Function_Hosting.md`, `desktop/07_Multi_Device_Network_Contract.md`, `mobile/08_Multi_Device_Network_Contract.md`, `web/02_State_and_Data_Flow.md`, `web/AGENTS.md` | Mechanical; no platform work is authorised beyond the rename (§9.3 — rename-only diff, no logic) |
| Code comments (spec citations per AGENTS.md §0.2) | 11 files under `apps/` (incl. `apps/web/src/proxy.ts`, `apps/web/src/lib/crypto.ts` — verified citing `23_Security_Harness_Plan.md §7`, `22_Redundancy_Audit.md §5`), 3 under `packages/`, 12 under `reference-implementations/` | Token-only comment edits; staying-topic citations untouched |
| `docs/` (incl. `docs/rfc/`, `docs/security/`) | `gated-review-packet-phases-1-3-4.md` (6), `security-master.md`, `SECURITY-AUDIT-2026-10.md` (17), `credential-exposure-2026-10.md`, `test-strategy.md` | Mechanical; historical audit reports keep original tokens only where quoting history (note, don't rewrite audit evidence) |
| `reviews/` | 4 files (2 + 1 + 1 + 1 lines) | Historical — append mapping note, do not rewrite |
| `worklog.md` | 4 filename lines + 1 §-ref line | **Frozen — never rewritten.** Append the mapping note on execution |
| Tests | `apps/web/tests/e2e/*` (incl. `zz-tmp-*` audit specs), `packages/core` tests | Token-only; re-run affected suites |

Out of scope: file contents (no prose changes — a rename PR that "also clarifies" is rejected), `00`–`20` (unique, untouched), mobile/desktop logic (locked until WEB-PROD-GATE).

---

## 6. Why renumber beats namespacing (packet options, decided)

The packet (Phase 1) lists three options; this proposal adopts Option 1 and records why Option 2 loses:

1. **`AGENTS.md` §17's flat index no longer works under namespacing.** The index maps spec file → principles/BR-IDs as a flat table. `platform/21_*` vs `systems/23_*` (packet Option 2) forces every index row, every §0.3 reading-order item, and every code comment citation to carry a directory qualifier — more structural change than the problem warrants, for a corpus that is flat today.
2. **`git log --follow` stays ambiguous under namespacing.** Two files still share the number; history queries by number still return two documents. Renumbering is the only option that restores "one number = one document."
3. **Churn is bounded and mechanical under renumbering.** §3 measures it: 39 filename lines + a 45-line triage list, token-only, script-gated (§4). The packet's "large mechanical diff" con is real but one-off; namespacing's con (a permanently qualified citation scheme every future agent must remember) is forever — the packet's Option 3 con applies to Option 2 as well.
4. **The staying-file choice minimises the diff further.** Keeping the three `AGENTS.md`-cited files at 21/22/23 leaves 94 of 124 filename lines untouched; only the 39 moved-topic lines change.

Rejected: Option 2 (namespace by domain) and Option 3 (document the collision and live with it) — per packet cons, adopted here.

---

## 7. Reviewers, rollback, execution

**Reviewers:** 2 + orchestrator sign-off (AGENTS.md §5.4 — touches `AGENTS.md`; §8 #6). No ledger/security reviewer required (no money, no crypto, no access-control change), but the security owner should be one of the two since §0.3 item 12 (security harness reading order) is edited.

**Rollback:** `git revert` — the rename is a pure move + token pass with no content changes, so revert is clean provided no later PR builds on the new numbers. The renumber PR merges with no stacked dependents; the verification script (§4) is kept in CI so a revert re-verifies the old baseline.

**Execution (post-ratification, separate PR):** `git mv` the three files → mechanical token pass for the 39 moved-topic lines → hand-triage the 45 §-ref lines → hand-edit the 6 `AGENTS.md` lines → run §4 script → append worklog mapping note → lint + typecheck + full test suites green. Anything beyond tokens is out of scope for that PR.
