// Implements: 10_Security.md §7 (a tenant-scoped endpoint that can be made to
// reach anything is not scoped) + AGENTS.md §2 Rule 2 (no undeclared outbound
// calls) + Rule 9 (fail closed).
//
// THE REGRESSION THIS FILE PINS.
//
// `x-db-url` is the tenant database's location and the gateway DIALS it
// (`getTurso` → the hrana client, and `batchExecute` → `fetch(`${url}/v2/pipeline`)`).
// `resolveTursoUrl` (lib/sql.ts) allowlists the SCHEME but not the HOST, so
// before this policy a caller who could get a signature over an `x-db-url`
// made the EDGE FUNCTION reach any host it named.
//
// MEASURED on the local rig:
//
//   x-db-url: http://127.0.0.1:9097
//     -> the gateway DIALED it:
//        POST /v2/pipeline
//        authorization: Bearer <the caller's db token>
//        body: {"requests":[{"type":"execute","stmt":{"sql":"SELECT * FROM students
//              WHERE tenant_id = ? ...","args":[...]}}, ...]}
//   x-db-url: http://169.254.169.254/latest/meta-data/ -> DIALED
//   x-db-url: http://10.0.0.5:8080 -> DIALED, and the request HUNG (the
//     libsql client has no connect timeout, so the isolate sat on the TCP
//     timeout).
//
// The web app signs whatever `db_url` it finds in `user_metadata`
// (apps/web/src/lib/db.ts:153 `getDbCredentials`), and `user_metadata` is the
// signed-in tutor's own — so the tutor can choose the host the EDGE reaches.
//
// WHY THE POLICY IS A HOST CHECK AND NOT A SCHEME CHECK: the scheme check
// already exists and is not the problem. The problem is that "http:" says
// nothing about WHERE.
import { describe, expect, it } from "vitest";
import { checkDbUrl, isForbiddenHost, isPrivateIpv4, isPrivateIpv6 } from "../lib/db-url-policy.ts";

describe("db-url policy — refuses a destination that is not a public host", () => {
  it("refuses loopback", () => {
    expect(checkDbUrl("http://127.0.0.1:9097").allowed).toBe(false);
    expect(checkDbUrl("http://127.0.0.1/v2/pipeline").allowed).toBe(false);
    expect(checkDbUrl("http://[::1]:9097").allowed).toBe(false);
  });

  it("refuses the link-local metadata address", () => {
    expect(checkDbUrl("http://169.254.169.254/latest/meta-data/").allowed).toBe(false);
    expect(checkDbUrl("http://169.254.169.254:80/").allowed).toBe(false);
  });

  it("refuses RFC1918 and other non-routable IPv4 space", () => {
    for (const host of [
      "http://10.0.0.5:8080",
      "http://172.16.0.1",
      "http://172.31.255.254",
      "http://192.168.1.1",
      "http://100.64.0.1",
      "http://0.0.0.0",
      "http://198.18.0.1",
      "http://224.0.0.1",
    ]) {
      expect(checkDbUrl(host).allowed, host).toBe(false);
    }
  });

  it("refuses the well-known local and internal hostnames", () => {
    for (const host of [
      "http://localhost",
      "http://localhost:8000",
      "http://app.localhost",
      "http://metadata.google.internal",
      "http://db.internal",
      "http://printer.local",
      "http://box.home.arpa",
    ]) {
      expect(checkDbUrl(host).allowed, host).toBe(false);
    }
  });

  it("refuses a scheme that is not a network location", () => {
    expect(checkDbUrl("file:///etc/passwd").allowed).toBe(false);
    expect(checkDbUrl("file:/tmp/x.db").allowed).toBe(false);
    expect(checkDbUrl("gopher://example.com").allowed).toBe(false);
    expect(checkDbUrl("data:text/plain,hi").allowed).toBe(false);
  });

  it("refuses a malformed URL", () => {
    expect(checkDbUrl("not a url").allowed).toBe(false);
    expect(checkDbUrl("http://").allowed).toBe(false);
  });

  it("ALLOWS an absent header (the deployment's own database)", () => {
    expect(checkDbUrl("").allowed).toBe(true);
    expect(checkDbUrl(null).allowed).toBe(true);
    expect(checkDbUrl(undefined).allowed).toBe(true);
  });

  it("ALLOWS a public Turso-shaped database location", () => {
    expect(checkDbUrl("libsql://my-tutor-db.turso.io").allowed).toBe(true);
    expect(checkDbUrl("https://my-tutor-db.turso.io").allowed).toBe(true);
    expect(checkDbUrl("https://db.example.com").allowed).toBe(true);
  });

  it("judges the REAL host, not the userinfo an attacker wants you to read", () => {
    // `http://127.0.0.1:9097@evil.example.com/` parses with
    // hostname = evil.example.com. The private address in the userinfo is a
    // decoy and must not decide the verdict.
    expect(checkDbUrl("http://127.0.0.1:9097@evil.example.com/").allowed).toBe(true);
    // …and the reverse: a private host hidden behind a public-looking
    // userinfo is still refused.
    expect(checkDbUrl("http://evil.example.com@127.0.0.1:9097/").allowed).toBe(false);
  });
});

describe("the host classifiers themselves", () => {
  it("isPrivateIpv4 covers the non-routable space and nothing else", () => {
    expect(isPrivateIpv4("127.0.0.1")).toBe(true);
    expect(isPrivateIpv4("169.254.169.254")).toBe(true);
    expect(isPrivateIpv4("10.1.2.3")).toBe(true);
    expect(isPrivateIpv4("172.16.0.1")).toBe(true);
    expect(isPrivateIpv4("192.168.0.1")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("93.184.216.34")).toBe(false);
    expect(isPrivateIpv4("not-an-ip")).toBe(false);
  });

  it("isPrivateIpv6 covers loopback, link-local, unique-local and v4-mapped", () => {
    expect(isPrivateIpv6("::1")).toBe(true);
    expect(isPrivateIpv6("::")).toBe(true);
    expect(isPrivateIpv6("fe80::1")).toBe(true);
    expect(isPrivateIpv6("fd00::1")).toBe(true);
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpv6("2606:4700:4700::1111")).toBe(false);
  });

  it("isForbiddenHost is the single decision both classifiers feed", () => {
    expect(isForbiddenHost("127.0.0.1")).toBe(true);
    expect(isForbiddenHost("localhost")).toBe(true);
    expect(isForbiddenHost("db.turso.io")).toBe(false);
  });
});
