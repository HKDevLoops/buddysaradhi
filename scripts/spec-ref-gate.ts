#!/usr/bin/env node
// scripts/spec-ref-gate.ts
// Implements: AGENTS.md §5.3 — "A PR without a `## Spec ref` block is
//   auto-blocked by CI" — and §5.2, whose PR template defines the block's
//   shape. Audit AUD-022 (docs/audit/AUDIT-2026-10-21.md) confirmed the gate
//   did not exist: a repo-wide search of `.github/workflows/**`, `scripts/**`
//   and `tools/**` for `Spec ref|spec-ref|spec_ref` returned zero hits.
//
// WHY THIS EXISTS. AGENTS.md §0.1 makes the spec the contract ("code without
//   a spec is tech debt") and §5.3 says CI blocks a PR that does not cite one.
//   Until now that promise was enforced by nothing but an agent's memory, so
//   the drift it was written to stop was free.
//
// WHAT IT CHECKS. A pull-request description must
//   1. carry a `## Spec ref` heading (§5.2's template), and
//   2. cite at least one spec file that EXISTS in this repository, drawn from
//      the canonical spec set — the numbered `NN_*.md` files at the repo root
//      and in the platform subdirectories `web/`, `product/`, `deployment/`,
//      `mobile/`, `desktop/` (AGENTS.md §3 file map), and
//   3. cite no `.md` file that does NOT exist. A citation of a spec that was
//      never written is a fake pass, so it fails.
//
// Exit 0 = the description cites a real spec. Exit 1 = the gate fails (the
//   reasons are printed). Exit 2 = harness error (bad usage).
//
// Zero new dependencies: plain Node (>=22) + node:fs.
//
// Usage:
//   node scripts/spec-ref-gate.ts --body-file pr-body.md
//   node scripts/spec-ref-gate.ts --body "## Spec ref ...""
//   node scripts/spec-ref-gate.ts            # reads stdin
//   PR_BODY="..." node scripts/spec-ref-gate.ts

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT: string = fileURLToPath(new URL("..", import.meta.url));

/** The platform subdirectories that hold their own numbered spec files. */
export const SPEC_DIRS: readonly string[] = [
  "",
  "web",
  "product",
  "deployment",
  "mobile",
  "desktop",
];

/** A spec file is a numbered `NN_*.md` inside one of the spec directories. */
const SPEC_FILE_RE = /^\d{2}_[A-Za-z0-9_-]*\.md$/;

export interface SpecRefResult {
  ok: boolean;
  /** Human-readable reasons the gate failed. Empty when `ok`. */
  problems: string[];
  /** The spec files cited by the `## Spec ref` block that exist on disk. */
  cited: string[];
  /** The `.md` files named by the block that do NOT exist on disk. */
  missing: string[];
}

/**
 * Every canonical spec file in the repository, as repo-relative POSIX paths.
 * The set is read from disk rather than hard-coded so an amended or added
 * spec file is citable the moment it lands.
 */
export function collectSpecSections(repoRoot: string = REPO_ROOT): string[] {
  const out: string[] = [];
  for (const dir of SPEC_DIRS) {
    const abs = path.join(repoRoot, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (!SPEC_FILE_RE.test(name)) continue;
      if (!existsSync(path.join(abs, name))) continue;
      out.push(dir === "" ? name : `${dir}/${name}`);
    }
  }
  return out.sort();
}

/**
 * The `## Spec ref` block: the text from the heading to the next `##` heading
 * (or the end of the description). Returns null when the heading is absent —
 * that absence is itself a failure (§5.3), never a pass.
 */
export function extractSpecRefBlock(body: string): string | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s*spec\s+ref\s*:?\s*$/i.test(l.trim()));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s+\S/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * Every `.md` file the block names. Backticks are the template's convention
 * (`07_Fees_and_Payments.md`), but a bare name is accepted too — the gate
 * checks the reference, not the punctuation.
 */
export function extractCitations(block: string): string[] {
  const out: string[] = [];
  const re = /([A-Za-z0-9_][A-Za-z0-9_./-]*\.md)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const ref = m[1];
    if (ref === undefined) continue;
    const cleaned = ref.replace(/^\.\//, "");
    if (!out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

/**
 * The gate itself. `sections` is the canonical spec set; `repoRoot` is used
 * to prove that a cited file exists.
 */
export function checkSpecRef(
  body: string,
  sections: string[] = collectSpecSections(),
  repoRoot: string = REPO_ROOT,
): SpecRefResult {
  const problems: string[] = [];
  const cited: string[] = [];
  const missing: string[] = [];

  const block = extractSpecRefBlock(body);
  if (block === null) {
    problems.push(
      "the description has no `## Spec ref` block (AGENTS.md §5.3 — a PR without one is auto-blocked)",
    );
    return { ok: false, problems, cited, missing };
  }

  const references = extractCitations(block);
  if (references.length === 0) {
    problems.push(
      "the `## Spec ref` block names no spec file — cite one, e.g. `07_Fees_and_Payments.md` §9 (AGENTS.md §5.2)",
    );
  }

  for (const ref of references) {
    if (!existsSync(path.join(repoRoot, ref))) {
      missing.push(ref);
      problems.push(`the `+"`## Spec ref`"+` block cites \`${ref}\`, which does not exist in this repository`);
      continue;
    }
    if (sections.includes(ref)) cited.push(ref);
  }

  if (references.length > 0 && cited.length === 0 && missing.length === 0) {
    problems.push(
      "the `## Spec ref` block cites no canonical spec section — the spec set is the numbered " +
        "`NN_*.md` files at the repo root and in `web/`, `product/`, `deployment/`, `mobile/`, `desktop/` " +
        "(AGENTS.md §3)",
    );
  }

  return { ok: problems.length === 0, problems, cited, missing };
}

function readBody(args: string[]): string {
  const bodyFlag = args.indexOf("--body");
  if (bodyFlag !== -1) {
    const value = args[bodyFlag + 1];
    if (value === undefined) throw new Error("--body needs a value");
    return value;
  }
  const fileFlag = args.indexOf("--body-file");
  if (fileFlag !== -1) {
    const value = args[fileFlag + 1];
    if (value === undefined) throw new Error("--body-file needs a path");
    return readFileSync(value, "utf8");
  }
  const envBody = process.env.PR_BODY;
  if (envBody !== undefined && envBody !== "") return envBody;
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main(): number {
  const args = process.argv.slice(2);
  let body: string;
  try {
    body = readBody(args);
  } catch (error) {
    process.stderr.write(`spec-ref-gate: cannot read the pull-request body: ${String(error)}\n`);
    return 2;
  }

  const result = checkSpecRef(body);
  if (result.ok) {
    process.stdout.write(
      `spec-ref-gate: PASS — cites ${result.cited.join(", ")}\n`,
    );
    return 0;
  }

  process.stderr.write("spec-ref-gate: FAIL — the pull-request description does not cite a real spec.\n");
  for (const problem of result.problems) process.stderr.write(`  - ${problem}\n`);
  process.stderr.write(
    "  Add a `## Spec ref` block (AGENTS.md §5.2): `Implements: <spec file> §<section>`.\n",
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  process.exit(main());
}
