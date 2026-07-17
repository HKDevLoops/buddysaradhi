/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction } from "@/server/actions/settings";
import { Moon, Sun, Smartphone, Palette, Type, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { NeumoToggle } from "./neumo-toggle";

import type { Settings } from "@/types/settings";

interface AppearanceSectionProps {
  settings: Settings;
}

// The 8 BuddySaradhi palettes. Each swatch previews its signature accent
// gradient. `dual` = the palette has both light & dark CSS variants and should
// respect the user's chosen Appearance Mode. Single-theme palettes (aurora,
// midnight) switch the mode to their natural theme when selected.
const PALETTES = [
  { id: "aurora-cosmic", label: "Aurora Cosmic", theme: "dark", dual: true, colors: ["#00FF9D", "#00F0FF", "#B388FF"] },
  { id: "violet-nebula", label: "Violet Nebula", theme: "dark", dual: true, colors: ["#A78BFA", "#C4B5FD", "#22D3EE"] },
  { id: "emerald-ledger", label: "Emerald Ledger", theme: "dark", dual: true, colors: ["#34D399", "#10B981", "#06B6D4"] },
  { id: "cyan-lagoon", label: "Cyan Lagoon", theme: "dark", dual: true, colors: ["#22D3EE", "#0891B2", "#67E8F9"] },
  { id: "rose-petal", label: "Rose Petal", theme: "dark", dual: true, colors: ["#FB7185", "#E11D48", "#FECDD3"] },
  { id: "amber-sunrise", label: "Amber Sunrise", theme: "dark", dual: true, colors: ["#FB923C", "#FBBF24", "#F59E0B"] },
  { id: "saffron-marigold", label: "Saffron Marigold", theme: "light", dual: true, colors: ["#FF9933", "#7B1E1E", "#FFB627"] },
  { id: "midnight-slate", label: "Midnight Slate", theme: "light", dual: true, colors: ["#0F172A", "#475569", "#94A3B8"] },
] as const;

const MODES = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Smartphone },
] as const;

export function AppearanceSection({ settings }: AppearanceSectionProps) {
  const queryClient = useQueryClient();
  const [selectedPalette, setSelectedPalette] = useState<string>(settings?.palette || "aurora-cosmic");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = localStorage.getItem("buddysaradhi.palette")
        || document.documentElement.getAttribute("data-palette")
        || settings?.palette
        || "aurora-cosmic";
      setSelectedPalette(p);
    }
  }, [settings?.palette]);

  const updateMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      const res = await updateSettingAction(field, value);
      if (!res.success) throw new Error(res.error || "Update failed");
    },
    onMutate: async ({ field, value }) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previousSettings = queryClient.getQueryData(["settings"]);
      queryClient.setQueryData(["settings"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          data: {
            ...old.data,
            [field]: value,
          },
        };
      });
      return { previousSettings };
    },
    onError: (err, variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(["settings"], context.previousSettings);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const [activeMode, setActiveMode] = useState<string>(settings?.theme || "system");

  useEffect(() => {
    setActiveMode(settings?.theme || "system");
  }, [settings?.theme]);

  const [activeDensity, setActiveDensity] = useState<string>(settings?.density || "comfortable");

  useEffect(() => {
    setActiveDensity(settings?.density || "comfortable");
  }, [settings?.density]);

  const density = activeDensity;
  const reducedMotion = settings?.reducedMotion === 1;
  const mode = activeMode;

  // Selecting a palette changes the ACCENT only. The Appearance Mode
  // (light/dark/system) remains the single source of truth for light vs dark:
  // dual-theme palettes render in whatever mode is active; single-theme
  // palettes (aurora = dark, midnight = light) switch the mode to their
  // natural theme so they display correctly.
  const applyPalette = (id: string, naturalTheme: "light" | "dark", dual: boolean) => {
    const html = document.documentElement;
    html.setAttribute("data-palette", id);
    localStorage.setItem("buddysaradhi.palette", id);
    setSelectedPalette(id);
    updateMutation.mutate({ field: "palette", value: id });

    if (!dual) {
      html.setAttribute("data-theme", naturalTheme);
      localStorage.setItem("buddysaradhi.theme", naturalTheme);
      updateMutation.mutate({ field: "theme", value: naturalTheme });
    }
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Palette className="w-5 h-5 text-[var(--accent-cyan)]" />
          Palette
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          Pick the accent palette for BuddySaradhi. Your choice applies instantly.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {PALETTES.map((p) => {
            const isActive = selectedPalette === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPalette(p.id, p.theme, p.dual)}
                aria-pressed={isActive}
                aria-label={`Use ${p.label} palette`}
                className={cn(
                  "glass-card p-4 rounded-xl flex flex-col items-center gap-3 transition-all cursor-pointer border",
                  isActive
                    ? "border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] shadow-[0_0_18px_color-mix(in_srgb,var(--accent-primary)_25%,transparent)]"
                    : "border-transparent bg-[var(--surface-glass-faint)] hover:bg-[var(--surface-glass)] hover:border-[var(--border-glass)]"
                )}
              >
                <div
                  className="w-full h-10 rounded-lg border border-[var(--border-glass)]"
                  style={{
                    background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]} 55%, ${p.colors[2]})`,
                  }}
                />
                <span
                  className={cn(
                    "text-xs font-semibold text-center",
                    isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                  )}
                >
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-[var(--border-glass)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Eye className="w-5 h-5 text-[var(--accent-violet)]" />
          Appearance Mode
        </h3>
        <div className="neumo-inset inline-flex p-1.5 rounded-full gap-1">
          {MODES.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setActiveMode(m.id);
                  const html = document.documentElement;
                  html.setAttribute("data-theme-preference", m.id);
                  if (m.id !== "system") {
                    html.setAttribute("data-theme", m.id);
                    localStorage.setItem("buddysaradhi.theme", m.id);
                  } else {
                    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                    html.setAttribute("data-theme", systemTheme);
                    localStorage.setItem("buddysaradhi.theme", systemTheme);
                  }
                  updateMutation.mutate({ field: "theme", value: m.id });
                }}
                aria-pressed={isActive}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all min-h-[44px] cursor-pointer border border-transparent",
                  isActive
                    ? "bg-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)] text-[var(--accent-primary)] border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] shadow-[0_0_12px_color-mix(in_srgb,var(--accent-primary)_15%,transparent)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-glass)]"
                )}
              >
                <Icon className="w-4 h-4" />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-[var(--border-glass)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Type className="w-5 h-5 text-[var(--accent-violet)]" />
          Display Density
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => {
              setActiveDensity("comfortable");
              localStorage.setItem("buddysaradhi.density", "comfortable");
              document.documentElement.setAttribute("data-density", "comfortable");
              updateMutation.mutate({ field: "density", value: "comfortable" });
            }}
            aria-pressed={density === "comfortable"}
            className={cn(
              "glass-card p-5 rounded-xl flex flex-col items-start gap-2 transition-all cursor-pointer text-left border",
              density === "comfortable"
                ? "border-[var(--accent-violet)] bg-[color-mix(in_srgb,var(--accent-violet)_15%,transparent)] shadow-[0_0_18px_color-mix(in_srgb,var(--accent-violet)_20%,transparent)]"
                : "border-transparent bg-[var(--surface-glass-faint)] hover:bg-[var(--surface-glass)] hover:border-[var(--border-glass)]"
            )}
          >
            <span className={cn("text-sm font-semibold", density === "comfortable" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>Comfortable</span>
            <span className="text-xs text-[var(--text-muted)] leading-relaxed">More whitespace, easier to tap on touch devices. Recommended for mobile.</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveDensity("compact");
              localStorage.setItem("buddysaradhi.density", "compact");
              document.documentElement.setAttribute("data-density", "compact");
              updateMutation.mutate({ field: "density", value: "compact" });
            }}
            aria-pressed={density === "compact"}
            className={cn(
              "glass-card p-5 rounded-xl flex flex-col items-start gap-2 transition-all cursor-pointer text-left border",
              density === "compact"
                ? "border-[var(--accent-violet)] bg-[color-mix(in_srgb,var(--accent-violet)_15%,transparent)] shadow-[0_0_18px_color-mix(in_srgb,var(--accent-violet)_20%,transparent)]"
                : "border-transparent bg-[var(--surface-glass-faint)] hover:bg-[var(--surface-glass)] hover:border-[var(--border-glass)]"
            )}
          >
            <span className={cn("text-sm font-semibold", density === "compact" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>Compact</span>
            <span className="text-xs text-[var(--text-muted)] leading-relaxed">Shows more data on screen. Recommended for desktop.</span>
          </button>
        </div>
      </div>

      <div className="h-px bg-[var(--border-glass)] w-full" />

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <EyeOff className="w-5 h-5 text-[var(--accent-amber)]" />
          Accessibility
        </h3>
        <div className="flex items-center justify-between glass-card p-5 rounded-xl">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Reduced Motion</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Disables non-essential animations and transitions.</p>
          </div>
          <NeumoToggle
            label="Reduced motion"
            checked={reducedMotion}
            onChange={() => updateMutation.mutate({ field: "reducedMotion", value: reducedMotion ? 0 : 1 })}
          />
        </div>
      </div>
    </section>
  );
}
