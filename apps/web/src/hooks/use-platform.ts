"use client";

import { useState, useEffect } from "react";

export type Platform = "web" | "macos" | "windows" | "android" | "ios" | "linux" | "unknown";

export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>("unknown");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const userAgent = window.navigator.userAgent.toLowerCase();
    
    if (userAgent.includes("macintosh") || userAgent.includes("mac os x")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlatform("macos");
    } else if (userAgent.includes("windows")) {
       
      setPlatform("windows");
    } else if (userAgent.includes("android")) {
       
      setPlatform("android");
    } else if (userAgent.includes("iphone") || userAgent.includes("ipad") || userAgent.includes("ipod")) {
       
      setPlatform("ios");
    } else if (userAgent.includes("linux")) {
       
      setPlatform("linux");
    } else {
      setPlatform("web");
    }
  }, []);

  return platform;
}
