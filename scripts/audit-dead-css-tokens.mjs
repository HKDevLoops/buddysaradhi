// Dead-token audit for apps/web: a custom property that is REFERENCED but never
// DEFINED anywhere in the cascade renders as an invalid value at computed-value
// time — which means the property using it silently falls back to `unset`.
//
// This exists because the migration left exactly that class of bug behind: 18
// tokens whose only definition sat inside unreachable
// `[data-theme-preference="onedark"|"nord"|…]` blocks, which broke the body
// background, the sticky table header, every `.glass-*` / `.neumo-*` surface and
// the whole accent-wash layer — while `eslint` and the static detector were both
// clean.
//
// Usage: node scripts/audit-dead-css-tokens.mjs
// Exit:  0 = no dangling reference, 1 = findings.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB_CSS = join("apps", "web", "src", "app", "globals.css");
const TOKENS_CSS = join("packages", "design-system", "tokens.css");

const sources = [
  { file: WEB_CSS, css: readFileSync(WEB_CSS, "utf8") },
  { file: TOKENS_CSS, css: readFileSync(TOKENS_CSS, "utf8") },
];

/** Strip comments so a token named in prose is not mistaken for a definition. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const defined = new Set();
for (const { css } of sources) {
  for (const match of stripComments(css).matchAll(/(--[a-z0-9-]+)\s*:/g)) {
    defined.add(match[1]);
  }
}

const findings = [];
for (const { file, css } of sources) {
  const lines = stripComments(css).split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      const name = match[1];
      if (!defined.has(name)) {
        findings.push({ file, line: index + 1, token: name, text: line.trim().slice(0, 90) });
      }
    }
  });
}

const unique = [...new Map(findings.map((f) => [`${f.file}:${f.line}:${f.token}`, f])).values()];
for (const finding of unique) {
  console.log(`  ${finding.file}:${finding.line}  ${finding.token}  ${finding.text}`);
}
console.log(`\ndead-token audit: ${unique.length} dangling reference(s), ${defined.size} tokens defined`);
process.exit(unique.length > 0 ? 1 : 0);