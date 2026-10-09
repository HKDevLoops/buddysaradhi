import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * An accent label must never be painted on a tint of its own accent.
 *
 * WCAG 2.1 AA 1.4.3 requires 4.5:1 for text. `--success` on `--success` at 10%
 * over `--surface-raised` measures **3.99:1** — axe caught exactly this on the
 * Students screen's "Add Student" button, and the identical construction appeared
 * 18 more times across seven files, most of them inside sheets and modals that are
 * unmounted during any a11y sweep and therefore invisible to one.
 *
 * The fix is to mix the label toward `--text-primary`, which raises contrast in
 * BOTH palettes: that token is near-white on dark (lifting the label off a dark
 * tint) and near-black on light (pushing it off a light tint). The hue survives
 * because it is only lightened or darkened, never replaced.
 *
 * Why a SOURCE SCAN and not a rendered assertion: the majority of these sites
 * live inside `AddStudentSheet`, `RecordPaymentSheet` and `GenerateInvoiceSheet`,
 * which are closed by default. A test that renders the five screens would pass
 * while fifteen broken buttons sat in the tree. This reads the source, so a
 * closed component is exactly as covered as an open one.
 *
 * Spec: AGENTS.md §2 Rule 10 (WCAG 2.1 AA, colour never the only signal);
 * `13_UI_Guidelines.md` §10. Rule 5 is also why the fix keeps the accent token
 * instead of reaching for a literal.
 */

const SRC_ROOT = join(__dirname, "..");

/** Directories whose class strings are rendered to a tutor. */
const SCANNED_ROOTS = ["components", "app"];

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__snapshots__") continue;
      tsxFiles(full, out);
    } else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * One element is at fault when a single class string tints its own background
 * with accent X and also colours its text with accent X. Spans may cross lines,
 * which is why `[^"'`]` rather than `\s`.
 *
 * A NUMBERED backreference, not `(?<accent>…)`/`\k<accent>`: this package's
 * tsconfig targets below ES2018, where named capturing groups are a compile
 * error. Vitest's transform accepts them, so the failure only surfaces in
 * `tsc` — which is the gate that matters.
 */
const OWN_TINT_LABEL =
  /bg-\[var\(--([a-z-]+)\)\]\/\d+[^"'`]{0,600}?\btext-\[var\(--\1\)\]/;

describe("accent-on-own-tint contrast (WCAG AA 1.4.3)", () => {
  const files = SCANNED_ROOTS.flatMap((root) => tsxFiles(join(SRC_ROOT, root)));

  it("scans a real number of components (a zero-file pass would pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no component colours a label with an accent it also uses as its background tint", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const match = OWN_TINT_LABEL.exec(source);
      if (!match) continue;
      const { line } = lineOf(source, match.index);
      offenders.push(
        `${relative(SRC_ROOT, file)}:${line}  bg-[var(--${match[1]})] + text-[var(--${match[1]})]`,
      );
    }
    expect(
      offenders,
      `Accent text on a tint of itself measures ~3.7–4.0:1, under the 4.5:1 required ` +
        `for text. Use the mixed label instead:\n` +
        `  text-[color-mix(in_srgb,var(--ACCENT)_60%,var(--text-primary))]\n\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the avatar paints initials with the mix, not the bare accent", () => {
    // The same defect shipped inside `components/ui/avatar.tsx` first. axe measured
    // 3.69:1–3.75:1 on three screens at once before it was fixed.
    const avatar = readFileSync(join(SRC_ROOT, "components", "ui", "avatar.tsx"), "utf8");
    expect(avatar).toMatch(/INITIALS_ACCENT_MIX/);
    expect(avatar).not.toMatch(/color:\s*`var\(--\$\{accent\}\)`/);
  });
});

function lineOf(source: string, index: number): { line: number } {
  return { line: source.slice(0, index).split("\n").length };
}