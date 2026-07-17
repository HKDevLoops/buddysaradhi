import React from "react";
import { PaletteProvider } from "@/lib/palette-provider";

// Implements: UI/web/02_Auth.md — Violet Nebula dark palette for auth screens
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PaletteProvider palette="violet-nebula" theme="dark">
      <main
        className="min-h-screen relative flex items-center justify-center p-4"
        style={{ background: "var(--bg-canvas)" }}
      >
        {/* Violet nebula aurora blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div
            className="absolute -top-1/2 -left-1/4 w-[80vw] h-[80vw] rounded-full blur-3xl"
            style={{ background: "radial-gradient(ellipse at center, color-mix(in srgb, var(--accent-primary) 6%, transparent) 0%, transparent 70%)" }}
          />
          <div
            className="absolute -bottom-1/2 -right-1/4 w-[80vw] h-[80vw] rounded-full blur-3xl"
            style={{ background: "radial-gradient(ellipse at center, color-mix(in srgb, var(--accent-secondary) 5%, transparent) 0%, transparent 70%)" }}
          />
        </div>

        {/* Centered glass card */}
        <div
          className="relative z-10 w-full max-w-md p-8 rounded-2xl shadow-2xl"
          style={{
            background: "var(--surface-glass-strong)",
            backdropFilter: "blur(24px) saturate(160%)",
            border: "1px solid var(--border-glass-strong)",
          }}
        >
          {children}
        </div>
      </main>
    </PaletteProvider>
  );
}
