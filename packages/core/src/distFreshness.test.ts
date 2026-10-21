// Implements: docs/audit/REMEDIATION-PLAN-2026-10-21.md row 1.20 (the web
// consumes core's BUILT `dist/`, not its source - a stale build silently
// serves the old money behaviour) and AGENTS.md §3.5 (one money flow, two I/O
// dialects: the dialects are the SOURCE, the `dist/` is what a consumer
// imports).
//
// WHAT THIS GUARDS. `@buddysaradhi/core` publishes `dist/`, and `apps/web`
// imports the package BY NAME, so the web runs the COMPILED artefact. When
// `dist/` is older than `src/`, every web test that touches money runs
// against the previous build - and says nothing about the code in the tree.
// The web's fees suite caught exactly that once; nothing stopped it from
// happening again.
//
// The fix is the build ORDERING in the consuming scripts (the web's `build`,
// `test` and `typecheck`, and the root's `test:unit`). This file is what
// stops the ordering from being quietly dropped in a later edit - a dropped
// `&& bun --filter @buddysaradhi/core build` is invisible in a diff review
// and fatal in a tutor's books.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../");

interface Manifest {
  name?: string;
  scripts?: Record<string, string>;
}

function manifest(relativePath: string): Manifest {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8")) as Manifest;
}

/** The command that CONSUMES the built artefact, per script name. */
const CONSUMER: Record<string, string> = {
  build: "next build",
  test: "vitest",
  typecheck: "tsc --noEmit",
};

/** The build step that must precede it. */
const BUILD_CORE = "bun --filter @buddysaradhi/core build";
const BUILD_SHARED = "bun --filter @buddysaradhi/shared build";

const web = manifest("apps/web/package.json");
const root = manifest("package.json");

describe("the build ordering that keeps a stale dist/ out of the suite (row 1.20)", () => {
  it.each(["build", "test", "typecheck"])(
    "the web's `%s` script builds core BEFORE it consumes core",
    (script) => {
      const body = web.scripts?.[script];
      expect(body, `apps/web must define a \`${script}\` script`).toBeDefined();
      const buildAt = body!.indexOf(BUILD_CORE);
      const consumerAt = body!.indexOf(CONSUMER[script]!);
      expect(buildAt, `the web's \`${script}\` must build @buddysaradhi/core first`).toBeGreaterThanOrEqual(0);
      expect(consumerAt, `the web's \`${script}\` must still run \`${CONSUMER[script]}\``).toBeGreaterThanOrEqual(0);
      expect(
        buildAt,
        `the web's \`${script}\` must build @buddysaradhi/core BEFORE \`${CONSUMER[script]}\``,
      ).toBeLessThan(consumerAt);
    },
  );

  it("the web's scripts build @buddysaradhi/shared too (the web imports its dist as well)", () => {
    for (const script of ["build", "test", "typecheck"]) {
      expect(web.scripts?.[script]).toContain(BUILD_SHARED);
    }
  });

  it("the root's unit suite builds core before it runs", () => {
    const body = root.scripts?.["test:unit"];
    expect(body, "the root must define a `test:unit` script").toBeDefined();
    expect(body!.indexOf(BUILD_CORE)).toBeLessThan(body!.indexOf("vitest run"));
  });

  it("the root's production build reaches the web's build, which builds core", () => {
    // The root delegates to the web, so the ordering is transitive: the root
    // build is safe as long as the script it calls builds core first.
    const rootBuild = root.scripts?.build ?? "";
    expect(rootBuild).toContain("bun --filter web build");
    expect(web.scripts?.build).toContain(BUILD_CORE);
  });
});
