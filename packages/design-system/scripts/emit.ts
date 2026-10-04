// Implements: docs/design/overhaul-plan.md §2.2 — emit the platform contract
// (`tokens.json`) and the web CSS projection (`tokens.css`), then run the
// verification gate.
//
// Run:  node packages/design-system/scripts/emit.ts
// Exit: 0 = emitted + verified; 1 = verification findings, and NOTHING is written,
//       so a failing palette can never reach an app.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgRoot: string = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot: string = join(pkgRoot, "..", "..");

// Build the TypeScript sources first: the generator IS the token logic, and a
// second copy of it in JS would be a second thing to keep in sync — the exact
// failure mode AGENTS.md §3.5 forbids for money logic and that applies to tokens
// for the same reason.
execFileSync(
  process.execPath,
  [
    join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    join(pkgRoot, "tsconfig.json"),
  ],
  { stdio: "inherit", cwd: repoRoot },
);

interface TokenFinding {
  severity: string;
  code: string;
  paletteId: string;
  message: string;
  measured?: number | string;
  required?: number | string;
}

interface VerifyApi {
  buildAndVerify: () => { palettes: unknown[]; findings: TokenFinding[] };
}

interface IndexApi {
  toJsonBundle: () => unknown;
  toCss: () => string;
}

const { buildAndVerify } = require(join(pkgRoot, "dist", "verify.js")) as VerifyApi;
const { toJsonBundle, toCss } = require(join(pkgRoot, "dist", "index.js")) as IndexApi;

const { palettes, findings }: { palettes: unknown[]; findings: TokenFinding[] } =
  buildAndVerify();
const errors: TokenFinding[] = findings.filter((f) => f.severity === "error");
const warns: TokenFinding[] = findings.filter((f) => f.severity === "warn");

console.log(`palettes: ${palettes.length}`);
console.log(`findings: ${errors.length} error(s), ${warns.length} warning(s)`);
for (const finding of findings) {
  const detail: string =
    finding.measured !== undefined ? ` (${finding.measured} / ${finding.required})` : "";
  console.log(
    `  [${finding.severity}] ${finding.code} ${finding.paletteId}: ${finding.message}${detail}`,
  );
}

if (errors.length > 0) {
  console.error("\nToken verification FAILED — nothing written. Fix the palette, not the gate.");
  process.exit(1);
}

mkdirSync(pkgRoot, { recursive: true });
writeFileSync(join(pkgRoot, "tokens.json"), `${JSON.stringify(toJsonBundle(), null, 2)}\n`, "utf8");
writeFileSync(join(pkgRoot, "tokens.css"), toCss(), "utf8");
console.log(`\nwrote ${join(pkgRoot, "tokens.json")}`);
console.log(`wrote ${join(pkgRoot, "tokens.css")}`);
