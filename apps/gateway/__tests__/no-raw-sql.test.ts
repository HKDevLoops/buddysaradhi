// Implements: AGENTS.md §3.4 (no raw-SQL escape hatch in app code) —
// regression guard for the security refactor that centralized every runtime
// SELECT/INSERT/UPDATE/DELETE into audited builders in `lib/sql.ts`.
//
// Allowed to hold SQL: `lib/schema.ts` (authorized DDL authority +
// one-time heals) and `lib/sql.ts` (audited builders). `migrations/` is
// one-time DDL (excluded). `__tests__/` uses SQL to assert rows (excluded).
// `graphql/index.ts` is a standalone Supabase Edge Function with its own
// `deno.json` (esm.sh, no shared import map) — it duplicates `resolvers.ts`
// shapes with parameterized `?` args and cannot import `lib/sql.ts` builders
// without cross-function bundling; documented exception, excluded here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GATEWAY_ROOT = fileURLToPath(new URL("..", import.meta.url));

const SCAN_DIRS = ["routes", "lib", "graphql", "provision"];

const EXCLUDED_FILES = new Set([
  "lib/schema.ts",
  "lib/sql.ts",
  "graphql/index.ts",
]);

const STATEMENT_RE =
  /\b(SELECT\s+[\w_*,"'`\s]+\s+FROM|INSERT\s+INTO|UPDATE\s+[a-z_"]+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|CREATE\s+TRIGGER|CREATE\s+INDEX)\b/i;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1 ");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("no-raw-sql: runtime SQL lives only in lib/sql.ts + lib/schema.ts", () => {
  it("finds zero SQL statement literals outside the two authorities", () => {
    const offenders: string[] = [];
    for (const sub of SCAN_DIRS) {
      const abs = `${GATEWAY_ROOT}/${sub}`;
      let files: string[] = [];
      try {
        files = walk(abs);
      } catch {
        continue;
      }
      for (const file of files) {
        const rel = file.slice(GATEWAY_ROOT.length + 1).replace(/\\/g, "/");
        const normalized = rel.startsWith("apps/gateway/")
          ? rel.slice("apps/gateway/".length)
          : rel;
        if (EXCLUDED_FILES.has(normalized)) continue;
        const src = readFileSync(file, "utf8");
        const code = stripComments(src);
        const match = code.match(STATEMENT_RE);
        if (match) {
          const lines = code.split("\n");
          const idx = lines.findIndex((l) => STATEMENT_RE.test(l));
          offenders.push(`${normalized}:${idx + 1}: ${match[0].slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
