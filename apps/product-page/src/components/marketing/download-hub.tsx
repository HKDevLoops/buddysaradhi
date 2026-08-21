"use client";

import React, { useEffect, useState } from "react";
import { DOWNLOAD_PLATFORMS } from "@/content/marketing/download";
import { detectPlatform, Platform } from "@/lib/detect-platform";
import { Monitor, Smartphone, Laptop, Sparkles, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

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
    if (platformId === "web") {
      window.location.href = `${APP_URL}/login`;
    } else {
      const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL || 'https://public.blob.vercel-storage.com';
      if (platformId === 'windows') {
        window.location.href = `${blobBase}/desktop/windows/buddysaradhi-setup.msi`;
      } else if (platformId === 'macos') {
        window.location.href = `${blobBase}/desktop/macos/buddysaradhi.dmg`;
      } else if (platformId === 'android') {
        window.location.href = `${blobBase}/mobile/android/buddysaradhi.apk`;
      }
    }
  };

  const getPlatformIcon = (id: string) => {
    switch (id) {
      case "web":
        return <Monitor className="w-5 h-5" />;
      case "macos":
      case "windows":
        return <Laptop className="w-5 h-5" />;
      case "android":
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
          "Tap 'Get on Play Store' to download the APK.",
          "Once downloaded, install the buddysaradhi.apk package on your phone.",
          "Ensure installation from untrusted sources is permitted.",
          "Open the app on your phone and authenticate with OTP."
        ];
      default:
        return [];
    }
  };

  return (
    <section id="download" className="relative z-10 mx-auto max-w-6xl px-6 py-24 border-t border-[var(--border-glass)]">
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="chip chip-info mb-4">
          <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
          Cross-Platform OS
        </span>
        <h2 className="font-[family-name:var(--font-heading)] text-4xl md:text-5xl font-semibold tracking-tight [text-wrap:balance] text-[var(--text-primary)]">
          Download BuddySaradhi for any device.
        </h2>
        <p className="mt-4 text-[var(--text-secondary)]">
          Zero servers to manage. Everything stays perfectly in sync using secure libSQL cloud storage, while running entirely on your local hardware.
        </p>
      </div>

      {/* Recommended Platform Banner */}
      {detected !== "web" && detected !== "linux" && detected !== "ios" && (
        <div className="mb-8 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[var(--surface-glass-strong)] border border-[var(--accent-emerald)]/30 text-xs text-[var(--accent-emerald)] font-mono font-semibold">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>DETECTED {detected.toUpperCase()} — Recommended build for your current device</span>
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
                "transition-all duration-200 rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden",
                isRecommended
                  ? "border border-[var(--accent-emerald)]/50 bg-[var(--surface-glass-strong)] shadow-[0_4px_24px_rgba(0,255,157,0.08)]"
                  : "border border-[var(--border-glass)] hover:border-[var(--border-strong)] bg-[var(--surface-glass-faint)] hover:bg-[var(--surface-glass)]",
                isWeb && "md:col-span-2 lg:col-span-1"
              )}
            >
              {isRecommended && (
                <div className="absolute top-0 right-0 px-3 py-1 rounded-bl-lg bg-[var(--accent-emerald)] text-[var(--text-on-accent)] font-semibold text-[10px] tracking-wider uppercase font-mono">
                  Recommended
                </div>
              )}

              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                      platform.accent === "emerald"
                        ? "bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] border border-[var(--accent-emerald)]/20"
                        : "bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/20"
                    )}
                  >
                    {getPlatformIcon(platform.id)}
                  </div>
                  <div>
                    <span className="text-[10px] tracking-wider font-mono font-semibold text-[var(--text-muted)] uppercase block">
                      {platform.eyebrow}
                    </span>
                    <h3 className="font-[family-name:var(--font-heading)] text-xl font-bold text-[var(--text-primary)]">
                      {platform.id === "macos" ? "macOS Desktop" : platform.id === "windows" ? "Windows PC" : platform.id === "android" ? "Android App" : "Web App"}
                    </h3>
                  </div>
                </div>

                <p className="text-sm text-[var(--text-secondary)] mb-6 min-h-[40px] leading-relaxed">
                  {platform.pitch}
                </p>

                {/* Inline installation step toggle */}
                {platform.id !== "web" && (
                  <div className="mb-6">
                    <button
                      onClick={() => setActiveAccordion(activeAccordion === platform.id ? null : platform.id)}
                      className="inline-flex items-center gap-1.5 text-xs text-[var(--accent-cyan)] font-mono font-medium hover:underline focus:outline-none min-h-[32px]"
                    >
                      <span>{activeAccordion === platform.id ? "Hide steps" : "Installation steps"}</span>
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 transition-transform duration-200",
                          activeAccordion === platform.id && "rotate-180"
                        )}
                      />
                    </button>

                    {activeAccordion === platform.id && (
                      <ol className="mt-3 space-y-2 text-xs text-[var(--text-secondary)] font-mono">
                        {getInstallSteps(platform.id).map((step, idx) => (
                          <li key={idx} className="flex gap-2 items-start">
                            <span className="text-[var(--accent-cyan)] shrink-0 font-bold">0{idx + 1}.</span>
                            <span>{step}</span>
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
                  "w-full min-h-[44px] py-2.5 px-4 rounded-xl font-semibold text-sm transition-all focus:outline-none active:scale-[0.98]",
                  platform.accent === "emerald"
                    ? "bg-[var(--accent-emerald)] text-[var(--text-on-accent)] hover:brightness-110"
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
