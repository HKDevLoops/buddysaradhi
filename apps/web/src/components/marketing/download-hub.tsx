"use client";

import React, { useEffect, useState } from "react";
import { DOWNLOAD_PLATFORMS, DownloadPlatform } from "@/content/marketing/download";
import { detectPlatform, Platform } from "@/lib/detect-platform";
import { Monitor, Smartphone, Laptop, Sparkles, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function DownloadHub() {
  const [detected, setDetected] = useState<Platform>("web");
  const [activeAccordion, setActiveAccordion] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const platform = detectPlatform(navigator.userAgent);
      setDetected(platform);
    }
  }, []);

  const handleDownload = (platformId: string) => {
    // In production, downloads redirect to Vercel Blob URLs or Store pages
    if (platformId === "web") {
      window.location.href = "/login";
    } else {
      window.location.href = `/download?platform=${platformId}`;
    }
  };

  const getPlatformIcon = (id: string) => {
    switch (id) {
      case "web":
        return <Monitor className="w-5 h-5" />;
      case "macos":
        return <Laptop className="w-5 h-5" />;
      case "windows":
        return <Laptop className="w-5 h-5" />;
      case "android":
        return <Smartphone className="w-5 h-5" />;
      case "ios":
        return <Smartphone className="w-5 h-5" />;
      default:
        return <Monitor className="w-5 h-5" />;
    }
  };

  const getInstallSteps = (id: string) => {
    switch (id) {
      case "macos":
        return [
          "Open the downloaded buddysaradhi.dmg file.",
          "Drag the BuddySaradhi app icon into your Applications folder.",
          "First launch: Right-click the app in Applications and choose 'Open' to bypass Apple Gatekeeper.",
          "Sign in with your email and access your secure local database."
        ];
      case "windows":
        return [
          "Run the downloaded buddysaradhi-setup.msi installer.",
          "If Windows SmartScreen warns you, click 'More info' then 'Run anyway' (code signature is pending EV-level status).",
          "Follow the setup wizard to complete the user-level installation.",
          "Launch BuddySaradhi from the desktop shortcut and sign in."
        ];
      case "android":
        return [
          "Tap 'Get on Play Store' to open the app page.",
          "Install BuddySaradhi directly from the Google Play Store.",
          "Open the app on your phone and authenticate with OTP.",
          "Ensure local SQLite data storage is permitted."
        ];
      case "ios":
        return [
          "Tap 'Get on App Store' (or Join TestFlight if beta is active).",
          "Install the app onto your iPhone.",
          "Open BuddySaradhi and authorize biometric login (FaceID) for quick access.",
          "Verify the offline synchronization is active in Settings."
        ];
      default:
        return [];
    }
  };

  return (
    <section id="download" className="relative z-10 mx-auto max-w-6xl px-6 py-24 border-t border-[var(--border-glass)]">
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="chip chip-info mb-4">
          <span className="chip-dot" aria-hidden="true" />
          Cross-Platform OS
        </span>
        <h2 className="font-[family-name:var(--font-heading)] text-4xl md:text-5xl font-semibold tracking-tight [text-wrap:balance] text-[var(--text-primary)]">
          Download BuddySaradhi for any device.
        </h2>
        <p className="mt-4 text-[var(--text-secondary)]">
          Five platforms, one database. Everything stays perfectly in sync using secure libSQL cloud storage, while running entirely on your local hardware.
        </p>
      </div>

      {/* Recommended Platform Banner */}
      {detected !== "web" && detected !== "linux" && (
        <div className="mb-8 flex items-center justify-center animate-pulse">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--accent-emerald)]/10 border border-[var(--accent-emerald)]/20 text-xs text-[var(--accent-emerald)] font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            Detected {detected.toUpperCase()} — Recommended for your current device
          </div>
        </div>
      )}

      {/* Grid Layout */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {DOWNLOAD_PLATFORMS.map((platform) => {
          const isRecommended = platform.id === detected;
          const isWeb = platform.id === "web";
          
          return (
            <div
              key={platform.id}
              className={cn(
                "glass transition-all duration-300 rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden",
                isRecommended
                  ? "border border-[var(--accent-emerald)]/40 shadow-[0_0_24px_color-mix(in_srgb,var(--accent-emerald)_15%,transparent)] bg-[var(--surface-glass-strong)]"
                  : "border border-[var(--border-glass)] hover:border-[var(--border-strong)] bg-[var(--surface-glass-faint)]",
                isWeb && "md:col-span-2 lg:col-span-1" // Web card styling
              )}
            >
              {isRecommended && (
                <div className="absolute top-0 right-0 px-3 py-1 rounded-bl-xl bg-[var(--accent-emerald)] text-[var(--text-on-accent)] font-semibold text-[10px] tracking-wider uppercase">
                  Best Fit
                </div>
              )}

              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center",
                      platform.accent === "emerald"
                        ? "bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]"
                        : "bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]"
                    )}
                  >
                    {getPlatformIcon(platform.id)}
                  </div>
                  <div>
                    <span className="text-[10px] tracking-wider font-semibold text-[var(--text-muted)] uppercase">
                      {platform.eyebrow}
                    </span>
                    <h3 className="font-[family-name:var(--font-heading)] text-xl font-bold text-[var(--text-primary)]">
                      {platform.id === "macos" ? "macOS Desktop" : platform.id === "windows" ? "Windows PC" : platform.id === "android" ? "Android App" : platform.id === "ios" ? "iOS App" : "Web App"}
                    </h3>
                  </div>
                </div>

                <p className="text-sm text-[var(--text-secondary)] mb-6 min-h-[40px]">
                  {platform.pitch}
                </p>

                {/* Inline installation step toggle */}
                {platform.id !== "web" && (
                  <div className="mb-6">
                    <button
                      onClick={() => setActiveAccordion(activeAccordion === platform.id ? null : platform.id)}
                      className="inline-flex items-center gap-1.5 text-xs text-[var(--accent-cyan)] hover:underline font-medium focus:outline-none"
                    >
                      <span>How to install</span>
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 transition-transform duration-200",
                          activeAccordion === platform.id && "rotate-185"
                        )}
                      />
                    </button>

                    {activeAccordion === platform.id && (
                      <ol className="mt-3 space-y-2 text-xs text-[var(--text-secondary)] list-decimal pl-4 animate-in slide-in-from-top-2 duration-200">
                        {getInstallSteps(platform.id).map((step, idx) => (
                          <li key={idx} className="pl-1">
                            {step}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => handleDownload(platform.id)}
                className={cn(
                  "w-full py-2.5 px-4 rounded-xl font-semibold text-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--bg-cosmic)] focus:ring-[var(--accent-cyan)]",
                  platform.accent === "emerald"
                    ? "bg-[var(--accent-emerald)] text-[var(--text-on-accent)] hover:brightness-110 shadow-[0_4px_12px_color-mix(in_srgb,var(--accent-emerald)_30%,transparent)]"
                    : "bg-transparent border border-[var(--accent-cyan)] text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/10"
                )}
              >
                {platform.primaryAction}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
