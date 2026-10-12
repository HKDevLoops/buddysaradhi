// Implements: black-box probe B3 (axe `page-has-heading-one` on the 404
// route), B9 (auth-aware 404 CTA — both states plus the fail-closed
// default), and B1 (the 404's own `<title>`).
//
// `not-found.tsx` cannot export `metadata` (Next's resolver only reads
// `layout`/`page`), so its title is a React 19 `<title>` element asserted
// from rendered markup — an export assertion here would be theatre.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import axe from "axe-core";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: vi.fn(async () => ({ auth: { getUser } })),
}));

import NotFound from "./not-found";
import { NotFoundState } from "@/components/ui/screen-state";

async function axeRules(html: string, rules: string[]) {
  document.body.innerHTML = html;
  try {
    return await axe.run(document.body, {
      runOnly: { type: "rule", values: rules },
    });
  } finally {
    document.body.innerHTML = "";
  }
}

beforeEach(() => {
  getUser.mockReset();
});

describe("404 heading (probe B3)", () => {
  it("renders the dead-end title as an h1 with identical styling", () => {
    const html = renderToStaticMarkup(<NotFoundState signedIn={false} />);
    expect(html).toContain("<h1");
    expect(html).not.toContain("<h2");
    expect(html).toContain("That page doesn&#x27;t exist");
    // Styling is unchanged — the level moved, the look did not.
    expect(html).toContain("text-lg font-semibold text-balance");
  });

  it("passes axe page-has-heading-one on the full 404 route", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const element = await NotFound();
    const html = renderToStaticMarkup(element);
    const results = await axeRules(html, ["page-has-heading-one"]);
    expect(results.violations).toEqual([]);
  });
});

describe("404 title (probe B1)", () => {
  it("emits its own <title>, not the root layout's", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const element = await NotFound();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("<title>Page not found · BuddySaradhi</title>");
  });
});

describe("404 CTA follows the session (probe B9)", () => {
  it("sends a signed-out tutor straight to login (no dashboard bounce)", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain('href="/login"');
    expect(html).toContain("Back to Login");
    expect(html).not.toContain("Go to Dashboard");
  });

  it("sends a signed-in tutor to the dashboard", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "tutor-1" } } });
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Go to Dashboard");
    expect(html).not.toContain("Back to Login");
  });

  it("fails closed to login when the session cannot be read", async () => {
    getUser.mockRejectedValue(new Error("supabase unreachable"));
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain('href="/login"');
    expect(html).toContain("Back to Login");
  });
});
