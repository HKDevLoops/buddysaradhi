import { test, expect } from "@playwright/test";

const PALETTES: { label: string; id: string }[] = [
  { label: "Aurora Cosmic", id: "aurora-cosmic" },
  { label: "Violet Nebula", id: "violet-nebula" },
  { label: "Emerald Ledger", id: "emerald-ledger" },
  { label: "Cyan Lagoon", id: "cyan-lagoon" },
  { label: "Rose Petal", id: "rose-petal" },
  { label: "Amber Sunrise", id: "amber-sunrise" },
  { label: "Saffron Marigold", id: "saffron-marigold" },
  { label: "Midnight Slate", id: "midnight-slate" },
];

const SCREENS = [
  { nav: /Dashboard/i, heading: /Dashboard/i },
  { nav: /Students/i, heading: /Students/i },
  { nav: /Attendance/i, heading: /Attendance/i },
  { nav: /Fees/i, heading: /Fees/i },
  { nav: /Settings/i, heading: /Settings/i },
];

async function fillField(page: import("@playwright/test").Page, label: string, value: string) {
  const input = page.getByLabel(label);
  for (let i = 0; i < 15; i++) {
    await input.click({ timeout: 2000 }).catch(() => {});
    await input.fill(value, { timeout: 2000 }).catch(() => {});
    const v = await input.inputValue().catch(() => "");
    if (v === value) return;
    await page.waitForTimeout(1000); // allow React hydration to settle
  }
  throw new Error(`Could not fill ${label}`);
}

async function authenticate(page: import("@playwright/test").Page) {
  const email = process.env.E2E_EMAIL || "hkdevloops@gmail.com";
  const password = process.env.E2E_PASSWORD || "hkdevs";
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const signIn = page.getByRole("button", { name: /^Sign In$/i });
  await signIn.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(800); // allow hydration
  await fillField(page, "Email", email);
  await fillField(page, "Password", password);
  await expect(signIn).toBeEnabled({ timeout: 10000 });
  await signIn.click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
}

// Read the computed glass background of the topbar (uses --surface-glass directly),
// which reflects the current palette + theme. Returns e.g. "rgba(r, g, b, a)".
async function glassColorOf(page: import("@playwright/test").Page): Promise<string> {
  const el = page.locator(".topbar").first();
  if ((await el.count()) === 0) {
    return page.locator(".glass-card").first().evaluate((e) => getComputedStyle(e).backgroundColor);
  }
  return el.evaluate((e) => getComputedStyle(e).backgroundColor);
}

// Click the *visible* nav control (sidebar on desktop, bottom-tab on mobile).
// We dispatch the click in the page (el.click()) to bypass the Next.js dev
// error-overlay portal, which is always present in dev and otherwise
// intercepts Playwright's actionability pointer-events check.
async function clickNav(page: import("@playwright/test").Page, name: RegExp) {
  const handle = await page.evaluateHandle((reSrc: string) => {
    const re = new RegExp(reSrc, "i");
    const btns = Array.from(document.querySelectorAll("button"));
    for (const b of btns) {
      const label = b.getAttribute("aria-label") || b.textContent || "";
      if (re.test(label) && b.offsetParent !== null) return b;
    }
    return null;
  }, name.source);
  const el = handle.asElement();
  if (!el) throw new Error(`No visible nav control for ${name}`);
  await el.evaluate((b: HTMLButtonElement) => b.click());
}

// Click a visible button by its accessible name via el.click() (see clickNav).
async function clickButton(page: import("@playwright/test").Page, name: RegExp) {
  const handle = await page.evaluateHandle((reSrc: string) => {
    const re = new RegExp(reSrc, "i");
    const btns = Array.from(document.querySelectorAll("button"));
    for (const b of btns) {
      const label = b.getAttribute("aria-label") || b.textContent || "";
      if (re.test(label) && b.offsetParent !== null) return b;
    }
    return null;
  }, name.source);
  const el = handle.asElement();
  if (!el) throw new Error(`No visible button for ${name}`);
  await el.evaluate((b: HTMLButtonElement) => b.click());
}

const BENIGN = /scroll-behavior|React DevTools|Fast Refresh|AuthApiError|Invalid Refresh Token|Download the React|aborted|access control checks|XMLHttpRequest\.open/i;

test.describe("Rigorous Stress Test — BuddySaradhi web", () => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    // Remove the Next.js dev error overlay so it never intercepts pointer events.
    // Real errors are still captured via console/pageerror listeners below.
    await page.addInitScript(() => {
      // Force-hide the Next.js dev error overlay so it never intercepts pointer
      // events. Real errors are still captured via the console/pageerror
      // listeners below and asserted at the end of the test.
      const apply = () => {
        if (!document.documentElement) return;
        const style = document.createElement("style");
        style.textContent = "nextjs-portal{display:none!important;pointer-events:none!important;}";
        document.documentElement.appendChild(style);
        const remove = () => {
          document.querySelectorAll("nextjs-portal").forEach((el) => {
            (el as HTMLElement).style.display = "none";
            (el as HTMLElement).style.pointerEvents = "none";
          });
        };
        const mo = new MutationObserver(remove);
        mo.observe(document.documentElement, { childList: true, subtree: true });
        remove();
      };
      apply();
      document.addEventListener("DOMContentLoaded", apply);
    });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => pageErrors.push(e.message));
  });

  test(
    "all 5 screens render, palette stress + persistence, responsive at 4 viewports",
    async ({ page }, testInfo) => {
      test.setTimeout(180000);
      await authenticate(page);
      await expect(page).toHaveTitle(/BuddySaradhi/);

    // --- 1. Every screen renders without error ---
    for (const s of SCREENS) {
      await clickNav(page, s.nav);
      await expect(page.locator("h1").first()).toContainText(s.heading, { timeout: 10000 });
      await page.screenshot({ path: `stress-shots/screen-${s.nav.source}.png` });
    }

    // --- 2. Palette stress: cycle all 8 palettes in BOTH light & dark,
    //        assert data-palette/data-theme update and glass is tinted (non-transparent)
    //        and varies per palette (proves accent-tinted glass, not plain white) ---
    await clickNav(page, /Settings/i);
    await clickButton(page, /^Appearance$/);
    await page
      .getByRole("button", { name: /Use Aurora Cosmic palette/i })
      .first()
      .waitFor({ state: "visible", timeout: 5000 });

    const glassByPalette: string[] = [];
    for (const p of PALETTES) {
      // select the palette (accent only; Appearance Mode stays the source of truth)
      await clickButton(page, new RegExp(`Use ${p.label} palette`, "i"));
      await expect(page.locator("html")).toHaveAttribute("data-palette", p.id, { timeout: 5000 });

      // LIGHT mode
      await clickButton(page, /^Light$/);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light", { timeout: 5000 });
      const lightGlass = await glassColorOf(page);
      expect(lightGlass, `Glass is transparent for ${p.id} (light)`).not.toBe("rgba(0, 0, 0, 0)");

      // DARK mode
      await clickButton(page, /^Dark$/);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", { timeout: 5000 });
      const darkGlass = await glassColorOf(page);
      expect(darkGlass, `Glass is transparent for ${p.id} (dark)`).not.toBe("rgba(0, 0, 0, 0)");

      glassByPalette.push(darkGlass);
    }

    // Glass tint must differ between palettes (each palette tints its own glass)
    for (let i = 1; i < glassByPalette.length; i++) {
      expect(
        glassByPalette[i],
        `Glass tint for palette ${i} equals previous palette — not accent-tinted`
      ).not.toBe(glassByPalette[i - 1]);
    }

    // --- 3. Persistence across full reload ---
    const persisted = await page.locator("html").getAttribute("data-palette");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-palette", persisted!, {
      timeout: 10000,
    });

    // --- 4. Responsiveness across 4 viewports ---
    const viewports = [
      { w: 375, h: 812, name: "mobile" },
      { w: 768, h: 1024, name: "tablet" },
      { w: 1280, h: 800, name: "desktop" },
      { w: 1920, h: 1080, name: "wide" },
    ];
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await clickNav(page, /Dashboard/i);
      await page.waitForTimeout(400);
      const bottomNav = page.locator("nav.md\\:hidden").first();
      if (vp.name === "mobile") {
        await expect(bottomNav).toBeVisible();
      } else {
        await expect(bottomNav).toBeHidden();
      }
      await page.screenshot({ path: `stress-shots/responsive-${vp.name}.png`, fullPage: true });
    }

    // --- 5. Concurrent-ish repeat pass to surface state leaks / flakiness ---
    for (let i = 0; i < 3; i++) {
      for (const s of SCREENS) {
        await clickNav(page, s.nav);
        await expect(page.locator("h1").first()).toContainText(s.heading, { timeout: 8000 });
      }
    }

    // --- 6. Report & assert no real errors ---
    const realConsole = consoleErrors.filter((t) => !BENIGN.test(t));
    const realPage = pageErrors.filter((t) => !BENIGN.test(t));
    await testInfo.attach("console-errors", { body: JSON.stringify(consoleErrors, null, 2) });
    await testInfo.attach("page-errors", { body: JSON.stringify(pageErrors, null, 2) });
    expect(realPage, `Page errors:\n${JSON.stringify(realPage, null, 2)}`).toEqual([]);
    expect(realConsole, `Console errors:\n${JSON.stringify(realConsole, null, 2)}`).toEqual([]);
  });
});
