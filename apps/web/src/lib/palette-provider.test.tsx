// Implements: 08_Settings.md §Appearance + 13_UI_Guidelines.md palette/theme contract
//
// F-2 class for theme (tests/e2e/stress.spec.ts:182): after the Light button
// writes data-theme + localStorage synchronously, a stale server echo
// (dbTheme from a pre-mutation settings response) must NEVER clobber the
// applied value. Same class already fixed for palette in 512f0e4 and density
// in 103036f. Rule 9: no silent clobber — the applied value is user intent.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/server/queries/settings", () => ({
  getSettings: vi.fn(),
}));

// Import AFTER mock is registered
import { getSettings } from "@/server/queries/settings";
import type { InstituteSettings } from "@/server/queries/settings";
import { PaletteProvider } from "@/lib/palette-provider";

const mockedGetSettings = vi.mocked(getSettings);

type SettingsResult = Awaited<ReturnType<typeof getSettings>>;

function echo(theme: string, palette = "inked", density = "comfortable"): SettingsResult {
  return {
    success: true,
    data: { theme, palette, density } as InstituteSettings,
  } as SettingsResult;
}

function renderProvider() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PaletteProvider>
        <div>child</div>
      </PaletteProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-theme-preference");
  // jsdom has no matchMedia — stub as light OS preference
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PaletteProvider applied-wins-over-stale-echo", () => {
  it("applied Light wins over a stale dark server echo (stress.spec.ts:182)", async () => {
    // Server still echoes the pre-click value (fallback-path write invisible
    // to gateway reads, or replication lag) while the device already applied Light.
    // Deferred echo: land it AFTER first paint so the test cannot pass
    // vacuously before the echo arrives (waitFor would resolve early).
    let resolveSettings!: (v: SettingsResult) => void;
    mockedGetSettings.mockReturnValue(
      new Promise<SettingsResult>((r) => {
        resolveSettings = r;
      }),
    );
    localStorage.setItem("buddysaradhi.theme", "light");
    localStorage.setItem("buddysaradhi.palette", "inked");

    renderProvider();

    // Applied value wins pre-echo (localTheme hydrated from localStorage)
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    // Land the stale echo; data-theme-preference tracks the raw echo so it
    // proves the echo arrived (React Query notifies outside act — poll for it).
    await act(async () => {
      resolveSettings(echo("dark"));
    });
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme-preference")).toBe("dark");
    });

    // Applied Light must survive the stale echo — DOM and localStorage
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("buddysaradhi.theme")).toBe("light");
  });

  it("applied palette still wins over stale server echo (F-2 guard, 512f0e4)", async () => {
    mockedGetSettings.mockResolvedValue(echo("dark"));
    localStorage.setItem("buddysaradhi.palette", "amethyst-mint");

    renderProvider();

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-palette")).toBe("amethyst-mint");
    });
  });

  it("applied density wins over a stale server echo (sibling class, 103036f)", async () => {
    mockedGetSettings.mockResolvedValue(echo("dark"));
    localStorage.setItem("buddysaradhi.density", "compact");

    renderProvider();

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    });
    expect(localStorage.getItem("buddysaradhi.density")).toBe("compact");
  });

  it("system preference still resolves live (no applied pin)", async () => {
    mockedGetSettings.mockResolvedValue(echo("system"));

    renderProvider();

    // Stubbed OS preference is light (matches:false)
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
  });
});
