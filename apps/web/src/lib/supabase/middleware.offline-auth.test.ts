// Implements: 3.5 (the web middleware must not make a Supabase Auth WAN call
// per request) and BR-SEC's single-active-session rule (the enforcement keeps
// its LIVE check, because a token's metadata is a snapshot).
//
// THE DEFECT: `updateSession` called `supabase.auth.getUser()` on EVERY
// request the middleware sees, and `getUser()` asks GoTrue to verify the
// session - a WAN round trip, measured at 236-707 ms. The API routes are the
// hot path, and every one of them paid it.
//
// THE FIX: the fast path is `getClaims()`, which verifies the JWT's signature
// locally against the project's JWKS and enforces `exp` without asking GoTrue.
// The round trip is paid only where it must be: when the local verification
// cannot decide (an expired token, which only `getUser` can refresh) and on
// the five screen routes, where the single-session enforcement compares the
// device cookie with the LIVE `active_session_id`.
//
// WHAT MUST NOT CHANGE: the enforcement's LIVENESS. A token's metadata is a
// snapshot, so a session opened on another device changes the live value
// without changing this token - an offline-only enforcement would compare
// against the device's own id and never fire.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const calls = { getClaims: 0, getUser: 0, signOut: 0 };

interface FakeClaims {
  sub: string;
  user_metadata: Record<string, unknown>;
}

let claims: FakeClaims | null = {
  sub: "user-1",
  user_metadata: {
    db_url: "libsql://buddysaradhi-abc.aws-ap-south-1.turso.io",
    active_session_id: "sess-1",
  },
};
let claimsError: { message: string } | null = null;
let claimsThrows = false;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => {
        calls.getClaims++;
        if (claimsThrows) throw new Error("JWKS fetch failed");
        return {
          data: { claims, headers: {}, signature: undefined },
          error: claimsError,
        };
      },
      getUser: async () => {
        calls.getUser++;
        return {
          data: {
            user: {
              id: "user-1",
              user_metadata: claims?.user_metadata ?? {},
            },
          },
          error: null,
        };
      },
      signOut: async () => {
        calls.signOut++;
      },
      updateUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
}));

import { updateSession } from "./middleware";

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(`https://buddysaradhi.app${path}`);
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

beforeEach(() => {
  calls.getClaims = 0;
  calls.getUser = 0;
  calls.signOut = 0;
  claims = {
    sub: "user-1",
    user_metadata: {
      db_url: "libsql://buddysaradhi-abc.aws-ap-south-1.turso.io",
      active_session_id: "sess-1",
    },
  };
  claimsError = null;
  claimsThrows = false;
});

describe("3.5 - the middleware's fast path is offline", () => {
  it("an API request with verifiable claims makes NO Auth round trip", async () => {
    const res = await updateSession(request("/api/v1/students"), NextResponse.next());
    expect(res.status).toBe(200);
    // THE MEASUREMENT: the WAN call is gone from the hot path.
    expect(calls.getUser).toBe(0);
    // ...and the local verification is what decided it.
    expect(calls.getClaims).toBe(1);
  });

  it("a marketing request with verifiable claims makes NO Auth round trip", async () => {
    await updateSession(request("/pricing"), NextResponse.next());
    expect(calls.getUser).toBe(0);
  });

  it("an unverifiable token falls back to the network - only getUser can REFRESH it", async () => {
    claims = null;
    claimsError = { message: "jwt expired" };
    const res = await updateSession(request("/api/v1/students"), NextResponse.next());
    expect(res.status).toBe(200);
    expect(calls.getUser).toBe(1);
  });

  it("a JWKS failure falls back to the network rather than logging the tutor out", async () => {
    // getClaims THROWS when the JWKS cannot be fetched. That is not an
    // authentication failure: the tutor must not be signed out because a
    // certificate could not be downloaded.
    claimsThrows = true;
    const res = await updateSession(request("/api/v1/students"), NextResponse.next());
    expect(res.status).toBe(200);
    expect(calls.getUser).toBe(1);
    expect(calls.signOut).toBe(0);
  });
});

describe("BR-SEC - the single-session enforcement keeps its LIVE check", () => {
  it("a screen route asks GoTrue for the live active_session_id", async () => {
    const res = await updateSession(
      request("/dashboard", { buddysaradhi_session: "sess-1" }),
      NextResponse.next(),
    );
    expect(res.status).toBe(200);
    // The live check is the ONE place the middleware still calls out, and it
    // runs on the five screen routes - where the enforcement lives.
    expect(calls.getUser).toBe(1);
    // The device cookie matches the live id, so nobody is kicked.
    expect(calls.signOut).toBe(0);
  });

  it("a screen route with a STALE device cookie signs the device out", async () => {
    // The live metadata says the active session is someone else's.
    claims = {
      sub: "user-1",
      user_metadata: {
        db_url: "libsql://buddysaradhi-abc.aws-ap-south-1.turso.io",
        active_session_id: "sess-2",
      },
    };
    const res = await updateSession(
      request("/dashboard", { buddysaradhi_session: "sess-1" }),
      NextResponse.next(),
    );
    // The stale device is signed out AND redirected, with the cookie deletes
    // forwarded into the redirect response.
    expect(res.status).toBe(307);
    expect(calls.signOut).toBeGreaterThan(0);
  });
});
