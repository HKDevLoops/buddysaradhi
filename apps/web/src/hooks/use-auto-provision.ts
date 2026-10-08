"use client";

// hooks/use-auto-provision.ts
// Implements: web/03_Auth_and_Provisioning.md Step 7 (a tutor whose tenant DB
// has not been created is provisioned on arrival, not shown an error) and
// 17_API_Gateway_System.md §5.1 (provisioning is idempotent). AGENTS.md §2 Rule 9
// — the tutor is either redirected or told what happened; there is no state in
// which the app silently shows a failed fetch.
//
// Detects DB_NOT_PROVISIONED (503 + needs_provision:true) responses from any API
// call and automatically calls /api/v1/provision in the background, then reloads
// the page so the user never sees the error.
//
// CONTRACT
// ────────
// OWNS: one monkey-patch of `window.fetch`, installed for as long as a caller is
//   mounted, that recognises the gateway's unprovisioned envelope and starts the
//   provision + reload cycle. One module-level lock (`provisioningInFlight`) and
//   one per-session attempt budget (`attemptsThisSession`, 3) — both survive
//   remounts, which is the point: a tutor whose page re-renders must not restart
//   a provision that is already running.
// RETURNS: nothing. `<AutoProvisionGuard />` renders `null`.
// ON UNMOUNT: the ORIGINAL `window.fetch` is restored, so the patch does not
//   outlive the tree. Two mounted guards would nest the patches and the first to
//   unmount would un-patch the second's interceptor; `installed` is per-instance,
//   so mount ONE (the `(app)` layout does). Nothing else is registered.
// DELIBERATELY DOES NOT: retry forever (bounded at 3 per session, then the
//   provision page takes over); intercept non-503 responses; parse a body that
//   is not JSON; swallow a fetch rejection (it routes to the provision page, and
//   the rejection is logged).
//
// THE ONE TIMER THAT IS NOT CLEANED UP, AND WHY THAT IS CORRECT. A successful
// provision schedules `window.location.reload()` in 1.5s. There is no
// `clearTimeout` in the cleanup, and adding one would be a bug: the reload is a
// DOCUMENT navigation, not a React effect. Unmounting the guard (a route change,
// a re-render that changes the tree shape) happens while the page is still alive
// and still un-provisioned, and cancelling the reload would leave the tutor on a
// screen whose every query still 503s — with the provision already done and
// nothing to trigger a retry. The timer is bounded, fires once, and its whole
// purpose is to outlive the component. Every OTHER subscription in this file is
// torn down.

import { useEffect, useRef, useCallback } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { log } from "@/lib/logger";

/** How many ms to wait before retrying after provision completes */
const RETRY_DELAY_MS = 1500;
/** Max provision attempts per session to avoid infinite loops */
const MAX_ATTEMPTS = 3;

let provisioningInFlight = false;
let attemptsThisSession = 0;

/**
 * Intercepts all fetch() calls globally. When any /api/v1/* response has
 * status 503 + needs_provision:true, silently runs /api/provision and
 * reloads the page so the user never sees the error.
 *
 * Safe to mount multiple times (uses a module-level lock).
 */
export function useAutoProvision() {
  const installed = useRef(false);

  const runProvision = useCallback(async () => {
    if (provisioningInFlight || attemptsThisSession >= MAX_ATTEMPTS) return;
    provisioningInFlight = true;
    attemptsThisSession++;

    try {
      const supabase = createSupabaseBrowser();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // No session — redirect to login
        window.location.href = "/login";
        return;
      }

      const res = await fetch("/api/v1/provision", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (res.ok) {
        // Refresh session so new db_url lands in cookie
        await supabase.auth.refreshSession();
        // Short delay then hard-reload so all data fetches retry cleanly.
        // Deliberately not cleared on unmount — see the header.
        setTimeout(() => window.location.reload(), RETRY_DELAY_MS);
      } else {
        // Provision failed — send user to the provision page
        window.location.href = "/signup/provision";
      }
    } catch (error) {
      // Rule 9: the tutor is redirected, so the failure is never silent — and
      // the reason is recorded so "why did I land on the provision page" is
      // answerable from Diagnostics instead of being guesswork.
      log.warn("auto_provision_failed", error instanceof Error ? error.message : String(error));
      window.location.href = "/signup/provision";
    } finally {
      provisioningInFlight = false;
    }
  }, []);

  useEffect(() => {
    if (installed.current) return;
    installed.current = true;

    const originalFetch = window.fetch.bind(window);

    // No `as any` (AGENTS §6.1): `window.fetch` IS the global `fetch` type, so
    // the patched function needs no cast to be assignable, and the parameters
    // are inferred rather than restated.
    window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const response = await originalFetch(...args);

      // Only intercept our own API routes. `RequestInit`'s input is
      // `string | URL | Request`; the old `(args[0] as Request).url ?? ""`
      // silently produced `""` for a `URL`, so a `fetch(new URL(...))` caller
      // was never intercepted. Duck-typing the two cases needs no cast and
      // cannot miss either (AGENTS §6.1).
      const input = args[0];
      const url =
        typeof input === "string" ? input : "url" in input ? input.url : input.href;
      if (response.status === 503 && url.includes("/api/v1/")) {
        try {
          // Clone so we can read the body without consuming it
          const clone = response.clone();
          const json = (await clone.json()) as { needs_provision?: boolean };
          if (json.needs_provision) {
            // Fire provision in background — don't await here
            void runProvision();
          }
        } catch (error) {
          // A 503 that is not our JSON envelope — another route's error shape.
          // That is a normal thing to meet and NOT a failure of this hook, but
          // dropping it silently is exactly the Rule 9 anti-pattern, so it is
          // recorded at warn level. The response is still returned untouched
          // either way: intercepting must never change what the caller sees.
          log.warn(
            "auto_provision_unreadable_503",
            error instanceof Error ? error.message : String(error),
            { url },
          );
        }
      }

      return response;
    };

    // Restore on cleanup
    return () => {
      window.fetch = originalFetch;
      installed.current = false;
    };
  }, [runProvision]);
}

/**
 * Drop this component anywhere in the client tree to enable auto-provisioning.
 * Typically placed in the root layout or dashboard layout.
 */
export function AutoProvisionGuard() {
  useAutoProvision();
  return null;
}