"use client";

// hooks/use-auto-provision.ts
// Implements: 18_Microservice_Architecture.md — client-side auto-heal
//
// Detects DB_NOT_PROVISIONED (503 + needs_provision:true) responses from
// any API call and automatically calls /api/provision in the background,
// then refreshes the page so the user never sees an error.
//
// Usage: mount once in the root layout via <AutoProvisionGuard />.

import { useEffect, useRef, useCallback } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

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

      const res = await fetch("/api/provision", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (res.ok) {
        // Refresh session so new db_url lands in cookie
        await supabase.auth.refreshSession();
        // Short delay then hard-reload so all data fetches retry cleanly
        setTimeout(() => window.location.reload(), RETRY_DELAY_MS);
      } else {
        // Provision failed — send user to the provision page
        window.location.href = "/signup/provision";
      }
    } catch {
      // Network error — send to provision page
      window.location.href = "/signup/provision";
    } finally {
      provisioningInFlight = false;
    }
  }, []);

  useEffect(() => {
    if (installed.current) return;
    installed.current = true;

    // Patch the global fetch to intercept 503 + needs_provision responses
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);

      // Only intercept our own API routes
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url ?? "";
      if (response.status === 503 && url.includes("/api/v1/")) {
        try {
          // Clone so we can read the body without consuming it
          const clone = response.clone();
          const json = await clone.json() as { needs_provision?: boolean };
          if (json.needs_provision) {
            // Fire provision in background — don't await here
            runProvision();
          }
        } catch {
          // JSON parse failed — not our error, ignore
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
