// The CSP nonce must reach Next's script tags, or the app never hydrates.
//
// The proxy set the CSP on the RESPONSE only, so Next 16 found no nonce while
// rendering and stamped none on its chunk tags - and CSP3 ignores 'self' once
// 'strict-dynamic' is present, so the browser refused every one of them.
// Measured live: 29 of 30 tags on /login un-nonced, React never hydrated, and
// the sign-in form did nothing - the app could not be signed into.
//
// A header-only assertion would have passed on the broken build, so this is a
// REAL-BROWSER test: it asserts the server's tags carry the enforced nonce,
// that the browser reports no CSP violation, and that React claimed the tree.
//
// Needs a running app: it targets CSP_PROBE_BASE_URL (default
// http://127.0.0.1:3000) and SKIPS loudly when none is reachable.
import { chromium, type Browser, type ConsoleMessage } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.CSP_PROBE_BASE_URL ?? "http://127.0.0.1:3000";

let browser: Browser;
let reachable = false;

beforeAll(async () => {
  try {
    const probe = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(10_000) });
    reachable = probe.ok;
  } catch {
    reachable = false;
  }
  if (reachable) browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

describe("the app hydrates: the CSP nonce reaches Next's script tags", () => {
  it("serves nonced script tags, produces NO CSP violation, and hydrates", async (ctx) => {
    if (!reachable) {
      ctx.skip(`no app at ${BASE} — set CSP_PROBE_BASE_URL to run this`);
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    const violations: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      const text = msg.text();
      if (/Content Security Policy|Refused to (execute|load|apply)/i.test(text)) {
        violations.push(text);
      }
    });

    // 1. The SERVER's HTML: every script tag must carry the enforced nonce.
    //    (The browser also injects dev-only chunks without a nonce — Turbopack's
    //    HMR client and the polyfill — so the DOM is not the right place to
    //    assert this. The server HTML is what the fix controls.)
    const raw = await (await fetch(`${BASE}/login`)).text();
    const serverTags = [...raw.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(serverTags.length, "the page must ship script tags").toBeGreaterThan(0);
    const nonced = serverTags.filter((t) => /\snonce="/.test(t));
    expect(
      nonced.length,
      `${serverTags.length - nonced.length} of ${serverTags.length} server script tags carry no nonce, and CSP3 ignores 'self' once 'strict-dynamic' is present, so those are BLOCKED`,
    ).toBe(serverTags.length);

    // 2. The browser agrees: no violation was reported.
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(1500);
    expect(violations, `CSP violations were reported: ${violations.join(" | ")}`).toHaveLength(0);

    // 3. The app hydrated. Before the fix `window.next` and `window.__next_f`
    //    were both undefined. In the App Router there is no `#__next` div - the
    //    marker is React's own `__reactFiber$` key on the container it manages.
    const hydration = await page.evaluate(() => ({
      next: typeof (window as unknown as { next?: unknown }).next,
      flight: typeof (window as unknown as { __next_f?: unknown }).__next_f,
      reactManaged: Object.keys(document.body).some((k) => k.startsWith("__reactFiber$")),
      bodyChildren: document.body.childElementCount,
    }));
    expect(hydration.next, "window.next must be defined (the Next runtime loaded)").toBe("object");
    expect(hydration.flight, "window.__next_f must be defined (the flight data loaded)").toBe("object");
    expect(hydration.reactManaged, "React must have claimed the container (the tree hydrated)").toBe(true);
    expect(hydration.bodyChildren, "the page must have rendered its content").toBeGreaterThan(0);

    await context.close();
  }, 180_000);
});
