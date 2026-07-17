import { chromium } from "playwright";

async function fillField(page, label, value) {
  const input = page.getByLabel(label);
  for (let i = 0; i < 15; i++) {
    await input.click({ timeout: 2000 }).catch(() => {});
    await input.fill(value, { timeout: 2000 }).catch(() => {});
    if ((await input.inputValue().catch(() => "")) === value) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Could not fill ${label}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message + "\n" + (e.stack || "")));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
const signIn = page.getByRole("button", { name: /^Sign In$/i });
await signIn.waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(800);
await fillField(page, "Email", "hkdevloops@gmail.com");
await fillField(page, "Password", "hkdevs");
await signIn.click();
await page.waitForURL("**/dashboard", { timeout: 20000 });
await page.waitForTimeout(2000);

// Try clicking each nav to surface which one errors
for (const name of ["Students", "Attendance", "Fees", "Settings"]) {
  const btns = page.getByRole("button", { name: new RegExp(name, "i") });
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
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
