"use client";

// Implements: 20_3D_Product_Page.md / `mobile/` + `desktop/` cross-platform
// parity — the one place the web build asks which platform it is running on, so
// the download hub and the platform-specific install copy branch on a single
// answer instead of three `userAgent` tests. AGENTS.md §2 Rule 4 (a platform
// branch is never a screen) and Rule 10 (the answer must not change the layout
// unpredictably — it only selects copy and an icon).

import { useState, useEffect } from "react";

/** The platforms the marketing surfaces distinguish. `web` = a desktop browser. */
export type Platform = "web" | "macos" | "windows" | "android" | "ios" | "linux" | "unknown";

/**
 * Reads the platform from a user-agent string.
 *
 * The order is load-bearing and was wrong once. iOS devices are matched BEFORE
 * macOS because two iOS user agents contain the macOS tokens: every iPhone
 * advertises `like Mac OS X`, and an iPad on desktop-class Safari reports
 * `Macintosh`. Testing `macintosh` first therefore answered `macos` for both —
 * the "Detect Apple platform" download button would have offered a Mac build to
 * someone holding an iPad, which is the exact confusion this function exists to
 * remove.
 */
function detectPlatform(userAgent: string): Platform {
  const ua = userAgent.toLowerCase();

  // iOS and iPadOS FIRST — see above. `cros` is Chrome on iPad, which is still
  // an iPad.
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod") || ua.includes("cros")) {
    return "ios";
  }
  if (ua.includes("android")) {
    return "android";
  }
  if (ua.includes("windows")) {
    return "windows";
  }
  if (ua.includes("macintosh") || ua.includes("mac os x")) {
    return "macos";
  }
  if (ua.includes("linux") || ua.includes("x11")) {
    return "linux";
  }
  // A browser we did not recognise is still a web browser. Answering
  // `unknown` here would leave every consumer with no branch at all.
  return "web";
}

/**
 * Which platform this browser is on.
 *
 * @returns `"unknown"` on the server and during the hydration render, then the
 *   real answer in the first render after hydration. The placeholder is
 *   deliberate: the server has no user agent, and returning the real platform on
 *   the client would be a hydration mismatch. Consumers must therefore treat
 *   `unknown` as "render the generic copy", which is the correct copy anyway —
 *   `unknown` is never a platform they can branch into.
 *
 * On unmount nothing is left behind: this reads one string once and registers
 * no listener, no timer and no observer. It does not re-read on resize or on a
 * platform change — a user agent cannot change mid-session, and watching for it
 * would be a subscription with no possible event.
 */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>("unknown");

  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading an
    // external value that does not exist during the hydration render; the server
    // has no user agent to read, so a state update is the only way to answer.
    setPlatform(detectPlatform(window.navigator.userAgent));
  }, []);

  return platform;
}