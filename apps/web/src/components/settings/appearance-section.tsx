/* eslint-disable react-hooks/set-state-in-effect */
"use client";

// Implements: docs/design/overhaul-plan.md §5 + W2 — Settings → Appearance.
// Three independent choices, presented as three decisions:
//   1. PALETTE (20, grouped dark / light, each showing its real generated swatches
//      and the Figma scheme it was derived from)
//   2. APPEARANCE MODE (light / dark / system)
//   3. MATERIAL (Minimal / Acrylic / Liquid Glass)
// plus the existing density and reduced-motion controls.
//
// Palette and mode are separate on purpose now. Every generated palette carries
// its own `color-scheme`, so a dark palette in light mode is a legitimate
// combination — the previous design forced single-theme palettes to override the
// user's mode, which fought the setting instead of honouring it.

import { useState, useEffect, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction } from "@/server/actions/settings";
import { Moon, Sun, Smartphone, Palette, Type, EyeOff, Layers, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { NeumoToggle } from "./neumo-toggle";
import {
  DEFAULT_MATERIAL_ID,
  DEFAULT_PALETTE_ID,
  DENSITY_STORAGE_KEY,
  RECENT_PALETTES_STORAGE_KEY,
  REDUCED_MOTION_STORAGE_KEY,
  MATERIAL_OPTIONS,
  MATERIAL_STORAGE_KEY,
  PALETTES,
  PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  resolveMaterialId,
  resolvePaletteId,
} from "@/lib/palettes";

import type { Settings } from "@/types/settings";

interface AppearanceSectionProps {
  settings: Settings;
}

const MODES = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Smartphone },
] as const;

type QuerySnapshot = unknown;

export function AppearanceSection({ settings }: AppearanceSectionProps) {
  const queryClient = useQueryClient();

  // Applied state (localStorage/DOM) is the truth; the server echo seeds it.
  const [selectedPalette, setSelectedPalette] = useState<string>(DEFAULT_PALETTE_ID);
  const [selectedMaterial, setSelectedMaterial] = useState<string>(DEFAULT_MATERIAL_ID);
  const [activeMode, setActiveMode] = useState<string>(settings?.theme || "system");
  const [activeDensity, setActiveDensity] = useState<string>("comfortable");
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  // Recently used palettes, most-recent first. A preference a tutor sets once should
  // stay reachable; 20 tiles in scheme order is a wall, not a picker.
  const [recentPalettes, setRecentPalettes] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    setSelectedPalette(
      resolvePaletteId(
        localStorage.getItem(PALETTE_STORAGE_KEY) ??
          root.getAttribute("data-palette") ??
          settings?.palette,
      ),
    );
    setSelectedMaterial(
      resolveMaterialId(localStorage.getItem(MATERIAL_STORAGE_KEY) ?? root.getAttribute("data-material")),
    );
    setActiveMode(settings?.theme || "system");
    setReducedMotion(
      document.documentElement.getAttribute("data-reduced-motion") === "1" ||
        localStorage.getItem(REDUCED_MOTION_STORAGE_KEY) === "1" ||
        settings?.reducedMotion === 1,
    );
    setRecentPalettes(
      (() => {
        try {
          return JSON.parse(localStorage.getItem(RECENT_PALETTES_STORAGE_KEY) ?? "[]") as string[];
        } catch {
          return [];
        }
      })(),
    );
    setActiveDensity(
      localStorage.getItem(DENSITY_STORAGE_KEY) ??
        root.getAttribute("data-density") ??
        settings?.density ??
        "comfortable",
    );
  }, [settings?.palette, settings?.theme, settings?.density, settings?.reducedMotion]);

  const updateMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      const res = await updateSettingAction(field, value);
      if (!res.success) throw new Error(res.error || "Update failed");
    },
    onMutate: async ({ field, value }) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previous: QuerySnapshot = queryClient.getQueryData(["settings"]);
      queryClient.setQueryData(["settings"], (old: Record<string, unknown> | undefined) => {
        if (!old) return old;
        const data = (old.data ?? {}) as Record<string, unknown>;
        return { ...old, data: { ...data, [field]: value } };
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["settings"], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const darkPalettes = useMemo(() => PALETTES.filter((p) => p.tier === "dark"), []);
  const lightPalettes = useMemo(() => PALETTES.filter((p) => p.tier === "light"), []);

  // Applying a palette is instant and local; PERSISTING it is debounced. Writing
  // the database on every click meant a tutor "trying" five palettes produced five
  // audited mutations and five outbox rows (Rule 7 writes those on purpose), so
  // exploring a preference generated a queue of sync traffic. One burst of
  // exploration is now one write, and the screen never waits for it.
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePersist = (field: string, value: unknown): void => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      updateMutation.mutate({ field, value });
    }, 800);
  };

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  const applyPalette = (id: string): void => {
    document.documentElement.setAttribute("data-palette", id);
    localStorage.setItem(PALETTE_STORAGE_KEY, id);
    setSelectedPalette(id);
    // Recency first: the palette a tutor opens the app with every day should be
    // the first tile they see, not the one that happens to sort alphabetically.
    setRecentPalettes((previous) => {
      const next = [id, ...previous.filter((p) => p !== id)].slice(0, 6);
      localStorage.setItem(RECENT_PALETTES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    schedulePersist("palette", id);
  };

  const applyMaterial = (id: string): void => {
    document.documentElement.setAttribute("data-material", id);
    localStorage.setItem(MATERIAL_STORAGE_KEY, id);
    setSelectedMaterial(id);
  };

  const applyMode = (id: string): void => {
    setActiveMode(id);
    const html = document.documentElement;
    html.setAttribute("data-theme-preference", id);
    // The PREFERENCE is what gets stored, not its current resolution. Storing
    // "dark" because that is what system resolved to right now pins the app to
    // dark for good: `system` could never be selected again and an OS flip would
    // stop being followed. The provider resolves the preference on every read.
    localStorage.setItem(THEME_STORAGE_KEY, id);
    schedulePersist("theme", id);
  };

  const applyDensity = (id: string): void => {
    setActiveDensity(id);
    localStorage.setItem(DENSITY_STORAGE_KEY, id);
    document.documentElement.setAttribute("data-density", id);
    schedulePersist("density", id);
  };

  const renderPaletteGrid = (title: string, options: typeof PALETTES) => (
    <div>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {title}
      </h4>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {options.map((palette) => {
          const isActive = selectedPalette === palette.id;
          return (
            <button
              key={palette.id}
              type="button"
              onClick={() => applyPalette(palette.id)}
              aria-pressed={isActive}
              aria-label={`Use the ${palette.name} palette, from Figma colour scheme ${palette.figmaScheme}`}
              className={cn(
                "flex min-h-[44px] cursor-pointer flex-col gap-2 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
                isActive
                  ? "border-[var(--accent-primary)] bg-[var(--surface-raised)]"
                  : "border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)]",
              )}
            >
              <span
                aria-hidden="true"
                className="flex h-9 w-full overflow-hidden rounded-lg border border-[var(--border-default)]"
              >
                <span className="flex-1" style={{ background: palette.swatch.canvas }} />
                <span className="flex-1" style={{ background: palette.swatch.raised }} />
                <span className="flex-1" style={{ background: palette.swatch.accent }} />
              </span>
              <span className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {palette.name}
                </span>
                {/* Selection is signalled by a check glyph and the word "Active",
                    not by border colour alone (Rule 10 / AP-14). The Material
                    picker already did this; the other three pickers did not, so
                    four sibling controls spoke three different languages. */}
                {isActive ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-primary)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-on-primary)]">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    Active
                  </span>
                ) : null}
              </span>
              <span className="text-[11px] leading-snug text-[var(--text-muted)]">
                Figma {palette.figmaScheme} · {palette.figmaName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const segmented = (
    options: readonly { id: string; label: string; icon?: React.ComponentType<{ className?: string }> }[],
    activeId: string,
    onSelect: (id: string) => void,
    ariaLabel: string,
  ) => (
    <div className="neumo-inset inline-flex flex-wrap gap-1 rounded-full p-1.5" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const isActive = activeId === option.id;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            // `aria-pressed` rather than a radio group: these are toggle buttons,
            // each of which is reachable by Tab and announces its own state, which
            // is what a screen-reader user needs from a single-select row.
            aria-pressed={isActive}
            className={cn(
              "flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
              isActive
                ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-on-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-row)] hover:text-[var(--text-primary)]",
            )}
          >
            {isActive ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
            {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 space-y-8 duration-300">
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-lg font-medium text-[var(--text-primary)]">
          <Palette className="h-5 w-5 text-[var(--accent-text)]" />
          Palette
        </h3>
        <p className="mb-5 max-w-prose text-sm text-[var(--text-muted)]">
          Twenty palettes, each derived from a Figma website colour scheme and contrast-checked for
          text, controls and status colour. Your choice applies instantly.
        </p>
        <div className="space-y-6">
          {renderPaletteGrid("Dark", darkPalettes as typeof PALETTES)}
          {renderPaletteGrid("Light", lightPalettes as typeof PALETTES)}
        </div>
      </div>

      <div className="h-px w-full bg-[var(--border-default)]" />

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-lg font-medium text-[var(--text-primary)]">
          <Sun className="h-5 w-5 text-[var(--accent-text)]" />
          Appearance Mode
        </h3>
        <p className="mb-4 max-w-prose text-sm text-[var(--text-muted)]">
          Every palette declares its own contrast scheme, so a dark palette can stay dark in light
          mode.
        </p>
        {segmented(MODES, activeMode, applyMode, "Appearance mode")}
      </div>

      <div className="h-px w-full bg-[var(--border-default)]" />

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-lg font-medium text-[var(--text-primary)]">
          <Layers className="h-5 w-5 text-[var(--accent-text)]" />
          Material
        </h3>
        <p className="mb-4 max-w-prose text-sm text-[var(--text-muted)]">
          How surfaces are rendered. Material only changes overlays, navigation and sheets — text
          and status colours never change, so a contrast ratio you can read today is the one you
          keep.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {MATERIAL_OPTIONS.map((material) => {
            const isActive = selectedMaterial === material.id;
            return (
              <button
                key={material.id}
                type="button"
                onClick={() => applyMaterial(material.id)}
                aria-pressed={isActive}
                className={cn(
                  "flex min-h-[44px] cursor-pointer flex-col gap-1 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
                  isActive
                    ? "border-[var(--accent-primary)] bg-[var(--surface-raised)]"
                    : "border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)]",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {material.name}
                  </span>
                  {isActive ? (
                    <span className="rounded-full bg-[var(--accent-primary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-on-primary)]">
                      Active
                    </span>
                  ) : null}
                </span>
                <span className="text-xs leading-snug text-[var(--text-muted)]">{material.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px w-full bg-[var(--border-default)]" />

      <div>
        <h3 className="mb-4 flex items-center gap-2 text-lg font-medium text-[var(--text-primary)]">
          <Type className="h-5 w-5 text-[var(--accent-text)]" />
          Display Density
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              {
                id: "comfortable",
                title: "Comfortable",
                body: "More whitespace, easier to tap on touch devices. Recommended for mobile.",
              },
              {
                id: "compact",
                title: "Compact",
                body: "Shows more rows on screen. Recommended for a dense desktop ledger.",
              },
            ] as const
          ).map((option) => {
            const isActive = activeDensity === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => applyDensity(option.id)}
                aria-pressed={isActive}
                className={cn(
                  "flex min-h-[44px] cursor-pointer flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
                  isActive
                    ? "border-[var(--accent-primary)] bg-[var(--surface-raised)]"
                    : "border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)]",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {option.title}
                  </span>
                  {isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-primary)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-on-primary)]">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      Active
                    </span>
                  ) : null}
                </span>
                <span className="text-xs leading-snug text-[var(--text-muted)]">{option.body}</span>
                {/* A real preview, not a sentence about one.
                    Three rows drawn at THIS option's metrics, using the same tokens
                    the ledger table uses — the difference the copy describes ("shows
                    more rows on screen") is the row height, so the row height is what
                    the tutor is shown. The palette tiles already set this precedent;
                    two of four pickers being label-only was the one real consistency
                    gap in the surface. */}
                <span
                  aria-hidden="true"
                  className="mt-2 flex w-full flex-col overflow-hidden rounded-md border border-[var(--border-default)]"
                >
                  {[0, 1, 2].map((row) => (
                    <span
                      key={row}
                      className="flex items-center gap-2 px-2"
                      style={{
                        height: option.id === "compact" ? "18px" : "26px",
                        background:
                          row % 2 === 0
                            ? "var(--surface-row)"
                            : "var(--surface-inset)",
                        borderTop:
                          row === 0 ? "none" : "1px solid var(--border-default)",
                      }}
                    >
                      <span
                        className="h-2 w-10 rounded-sm"
                        style={{ background: "var(--text-muted)" }}
                      />
                      <span
                        className="h-2 flex-1 rounded-sm"
                        style={{ background: "var(--surface-sunken)" }}
                      />
                      <span
                        className="h-2 w-8 rounded-sm"
                        style={{ background: "var(--accent-text)" }}
                      />
                    </span>
                  ))}
                </span>
                <span className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {option.id === "compact" ? "18px rows" : "26px rows"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px w-full bg-[var(--border-default)]" />

      <div>
        <h3 className="mb-4 flex items-center gap-2 text-lg font-medium text-[var(--text-primary)]">
          <EyeOff className="h-5 w-5 text-[var(--warning)]" />
          Accessibility
        </h3>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Reduced Motion</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Disables non-essential animations and transitions.
            </p>
          </div>
          <NeumoToggle
            label="Reduced motion"
            checked={reducedMotion}
            onChange={() => {
              // Write the DOM + localStorage FIRST so the screen responds on this
              // tap, then persist. The previous order (database only) left the
              // switch inert: nothing consumed the value, so the promise in this
              // row was not kept.
              const next = reducedMotion ? "0" : "1";
              setReducedMotion(next === "1");
              localStorage.setItem(REDUCED_MOTION_STORAGE_KEY, next);
              const html = document.documentElement;
              if (next === "1") html.setAttribute("data-reduced-motion", "1");
              else html.removeAttribute("data-reduced-motion");
              updateMutation.mutate({ field: "reducedMotion", value: next === "1" ? 1 : 0 });
            }}
          />
        </div>
      </div>
    </section>
  );
}