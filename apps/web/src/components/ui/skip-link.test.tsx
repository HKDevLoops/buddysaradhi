// Implements: AGENTS.md §2 Rule 10 / WCAG 2.4.1 Bypass Blocks — black-box
// probe B4 (axe `region`: the `.sr-only` skip link sat directly under
// `<body>`, outside every landmark, on all pages).
//
// The fix (components/ui/skip-link.tsx) nests the link inside a
// `<nav aria-label="Skip links">` landmark without changing tab order, focus
// behaviour, or visuals. These tests pin both halves: the link still targets
// `#main-content` as the first tab stop, and axe `region` passes on a
// login-shaped tree (skip link + lone `<main>`, the minimal-auth-surface
// layout) and on an app-shaped tree (skip link + aside/header/main/footer,
// the GlassShell layout).

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import axe from "axe-core";
import { SkipLink } from "@/components/ui/skip-link";

function loginTree() {
  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1}>
        <h1>Welcome Back</h1>
        <form>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" />
        </form>
      </main>
    </>
  );
}

function appTree() {
  return (
    <>
      <SkipLink />
      <aside>
        <nav aria-label="Screens">
          <button type="button">Dashboard</button>
        </nav>
      </aside>
      <div>
        <header>
          <h2>Dashboard</h2>
        </header>
        <main id="main-content" tabIndex={-1}>
          <h1>Dashboard KPIs</h1>
        </main>
        <footer>
          <span>v1.0.0</span>
        </footer>
      </div>
    </>
  );
}

async function regionViolations(html: string) {
  document.body.innerHTML = html;
  try {
    const results = await axe.run(document.body, {
      runOnly: { type: "rule", values: ["region"] },
    });
    return results.violations;
  } finally {
    document.body.innerHTML = "";
  }
}

describe("skip link landmark placement (probe B4)", () => {
  it("keeps the link first in tab order and targeting #main-content", () => {
    const html = renderToStaticMarkup(loginTree());
    const navIndex = html.indexOf('aria-label="Skip links"');
    const mainIndex = html.indexOf("<main");
    expect(navIndex).toBeGreaterThanOrEqual(0);
    expect(mainIndex).toBeGreaterThan(navIndex);
    expect(html).toContain('href="#main-content"');
    expect(html).toContain("Skip to main content");
  });

  it("passes axe region on the login-shaped tree", async () => {
    expect(await regionViolations(renderToStaticMarkup(loginTree()))).toEqual([]);
  });

  it("passes axe region on the app-shaped tree", async () => {
    expect(await regionViolations(renderToStaticMarkup(appTree()))).toEqual([]);
  });
});
