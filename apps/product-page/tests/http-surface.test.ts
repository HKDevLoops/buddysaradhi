// Implements: 10_Security.md §6 (XSS-1 / CSRF) + 23_Security_Harness_Plan.md §7
// and the SEO contract for a marketing surface.
//
// These are SOURCE-level assertions on the security surface of this app.
// They exist because the failures they guard are the kind that survive a
// review: a CSP that quietly regains `'unsafe-inline'`, a robots rule that
// stops disallowing the console, a copy line that promises an email the
// product does not send.
//
// The live behaviour of each of these is measured separately (see
// docs/audit/DYNAMIC-PRODUCTPAGE.md); these tests are the cheap, always-on
// guard.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");

const read = (relative: string): string =>
  readFileSync(resolve(appDir, relative), "utf8");

describe("the console is not indexed (10_Security.md §6)", () => {
  it("ships a robots.txt that disallows the console and the API", () => {
    const source = read("src/app/robots.ts");
    expect(existsSync(resolve(appDir, "src/app/robots.ts"))).toBe(true);
    expect(source).toContain('"/admin"');
    expect(source).toContain('"/api/"');
  });

  it("keeps the console's own noindex meta", () => {
    expect(read("src/app/admin/layout.tsx")).toContain("robots: { index: false");
  });
});

describe("the Content-Security-Policy has two policies, and they do not overlap", () => {
  const config = read("next.config.ts");
  const proxy = read("src/proxy.ts");

  it("does not let the static policy cover /admin", () => {
    // The console gets the stricter nonce policy from src/proxy.ts. If the
    // static policy also matched /admin the precedence would be a question
    // nobody could answer from the code.
    expect(config).toContain('source: "/((?!admin).*)"');
  });

  it("keeps 'unsafe-inline' out of the CONSOLE's script-src", () => {
    // The line that actually builds the policy, not the comment that
    // explains it.
    const scriptSrc =
      /[^\n]*script-src[^\n]*nonce-\$\{nonce\}[^\n]*/.exec(proxy)?.[0] ?? "";
    expect(scriptSrc).toContain("'nonce-${nonce}'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("unsafe-inline");
  });

  it("keeps 'unsafe-eval' out of every policy - three.js does not need it", () => {
    expect(config).not.toContain("unsafe-eval");
    expect(proxy).not.toContain("unsafe-eval");
  });

  it("does not allow a new origin into connect-src", () => {
    // The only outbound origin this site has is the gateway, and it is
    // already listed. A new one would be a new integration (Rule 2).
    expect(config).toContain(`"connect-src 'self' https://api.buddysaradhi.app"`);
    const connectSrcs = config.match(/connect-src[^"]*/g) ?? [];
    for (const line of connectSrcs) {
      const origins = line.match(/https?:\/\/[^\s'"]+/g) ?? [];
      expect(origins).toEqual(["https://api.buddysaradhi.app"]);
    }
  });
});

describe("the public write endpoint is same-origin gated (CSRF)", () => {
  const route = read("src/app/api/access-request/route.ts");

  it("resolves the origin verdict before it touches the store", () => {
    // Compare the USAGE, not the import: the import is above everything.
    // Between the verdict and the store there must be a RETURN, or the gate
    // is decorative.
    const verdictAt = route.lastIndexOf("resolveOriginVerdict(");
    const storeAt = route.lastIndexOf("resolveAccessRequestStore(");
    expect(verdictAt).toBeGreaterThan(-1);
    expect(storeAt).toBeGreaterThan(-1);
    expect(verdictAt).toBeLessThan(storeAt);
    const between = route.slice(verdictAt, storeAt);
    expect(between).toMatch(/if\s*\(!verdict\.allowed\)\s*\{\s*return refuseCrossOrigin\(\);\s*\}/);
  });

  it("refuses with a typed 403 rather than a silent drop", () => {
    expect(route).toContain("refuseCrossOrigin");
    expect(route).toContain("status: 403");
  });

  it("refuses with ONE message, whatever the caller sent", () => {
    // A refusal that varies with the email would turn the endpoint into an
    // enumeration oracle.
    const refusal = /function refuseCrossOrigin\(\)[\s\S]*?\n}/.exec(route)?.[0] ?? "";
    expect(refusal).toContain("status: 403");
    expect(refusal).not.toMatch(/email|name|institute/i);
  });
});

describe("the copy tells the truth about delivery (Rule 9)", () => {
  it("does not promise an email the product does not send", () => {
    const form = read("src/app/request-access/access-request-form.tsx");
    // The heading the visitor reads, not the comment that quotes the old
    // one.
    expect(form).not.toContain('heading: "Received. We will reply by email."');
  });

  it("names the console as the place the request lands", () => {
    const form = read("src/app/request-access/access-request-form.tsx");
    expect(form).toContain("operations console");
  });
});

describe("the access-request store reads the deployment's own env names", () => {
  const lib = read("src/app/admin/_lib/access-requests.ts");

  it("accepts NEXT_PUBLIC_SUPABASE_URL, which is what the deployment sets", () => {
    // The deployment sets NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
    // Reading only SUPABASE_URL left the URL missing, the store half
    // configured, and every request to /api/access-request answering 503 in
    // production while the marketing copy promised a recorded request.
    expect(lib).toContain("process.env.NEXT_PUBLIC_SUPABASE_URL");
  });

  it("still prefers an explicit server-side SUPABASE_URL", () => {
    expect(lib).toContain("process.env.SUPABASE_URL ??");
  });
});
