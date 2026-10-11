import { chromium, type Page } from "playwright";

async function fillField(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByLabel(label);
  for (let i: number = 0; i < 15; i++) {
    await input.click({ timeout: 2000 }).catch(() => {});
    await input.fill(value, { timeout: 2000 }).catch(() => {});
    if ((await input.inputValue().catch(() => "")) === value) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Could not fill ${label}`);
}

const browser = await chromium.launch();
const page: Page = await browser.newPage();
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
page.on("pageerror", (e: Error) => pageErrors.push(e.message + "\n" + (e.stack || "")));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// Implements: 23_Security_Harness_Plan.md §5.1 STEP 1 — a credential must never
// be committed. This ad-hoc driver used to carry a literal email + password.
// It now reads the same E2E_EMAIL / E2E_PASSWORD pair as the Playwright suite
// and refuses to run without them, rather than falling back to a value that
// would end up in git history again.
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD) {
  throw new Error(
    "debug-errors requires E2E_EMAIL and E2E_PASSWORD in the environment (apps/web/.env.local or the shell). " +
      "It carries no built-in credential and will not fall back to one.",
  );
}

await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
const signIn = page.getByRole("button", { name: /^Sign In$/i });
await signIn.waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(800);
await fillField(page, "Email", EMAIL);
await fillField(page, "Password", PASSWORD);
await signIn.click();
await page.waitForURL("**/dashboard", { timeout: 20000 });
await page.waitForTimeout(2000);

// Try clicking each nav to surface which one errors
for (const name of ["Students", "Attendance", "Fees", "Settings"]) {
  const btns = page.getByRole("button", { name: new RegExp(name, "i") });
  const n: number = await btns.count();
  for (let i: number = 0; i < n; i++) {
    const b = btns.nth(i);
    if (await b.isVisible().catch(() => false)) {
      await b.click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(1500);
}

console.log("=== PAGE ERRORS ===");
console.log(pageErrors.join("\n----\n") || "(none)");
console.log("=== CONSOLE ERRORS ===");
console.log(consoleErrors.join("\n") || "(none)");

await browser.close();
