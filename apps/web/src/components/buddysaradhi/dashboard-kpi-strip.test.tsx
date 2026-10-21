// Implements: 04_Dashboard.md §6.2 (the KPI strip's seven cards) + §6.3 (the
// strip's grid) + §18 (the cards are real controls); 13_UI_Guidelines.md §5.4
// (glass + accent left-border, not a full accent stroke), §5.5 (the KPI card is
// `glass` + the accent left-border) and §10 (WCAG 1.4.11 — a meaningful
// boundary needs 3 : 1); AGENTS.md §2 Rule 5 (colour comes from a token, never a
// literal) and Rule 10 (colour is never the only signal, contrast is measured).
//
// TWO FINDINGS, ONE FILE, BOTH MEASURED:
//
// PERF-4.6 — THE STRIP MUST NEVER STRAND A CARD. The strip holds SEVEN cards
// (C1..C6 plus Overdue) and seven divides by none of 1, 2, 3 or 6, so the grid
// left the seventh card alone on its own row at every width: 3 + 3 + 1 on lg,
// 6 + 1 on 2xl, 2 + 2 + 2 + 1 on sm. The last card now spans the full row, so
// the six above it tile evenly and the seventh is a band.
//
// A11Y-4.7 — THE CARD'S BOUNDARY MUST CLEAR 3 : 1. It was a 1 px accent tint
// at 25 % over `--surface-raised` (#1C1D20): success 1.40 : 1, warning
// 1.39 : 1, info 1.39 : 1, danger 1.38 : 1 — below the 3 : 1 floor for a
// meaningful boundary. It is now `var(--border-strong)` (3.006 : 1) around
// the card and a 2 px left-bar in the FULL accent (4.50–4.52 : 1), which is
// the recipe `13_UI_Guidelines.md` §5.4 prescribes.
//
// THE CONTRAST NUMBERS IN THIS FILE ARE MEASURED, NOT ASSERTED FROM A
// COMMENT: the tokens are read out of the design system's own generated
// `tokens.css` — the same file `app/globals.css` imports — and the ratios are
// computed with the design system's own `contrastRatio`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { contrastRatio, hexToRgb } from "@buddysaradhi/design-system";

vi.mock("@/server/actions/dashboard", () => ({
  fetchDashboardSummaryAction: vi.fn(),
  fetchDashboardAnalyticsAction: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/components/buddysaradhi/dashboard-analytics", () => ({
  DashboardAnalyticsSection: () => <section aria-label="Business analytics stub" />,
}));

import { fetchDashboardSummaryAction } from "@/server/actions/dashboard";
import { DashboardClient } from "./dashboard-client";
import type { DashboardKpis, DashboardSummary } from "@/server/actions/dashboard";
import type { PeriodWindow } from "@/lib/dashboard-period";

/**
 * The design system's GENERATED token file — the same one
 * `app/globals.css` imports (`@import "@buddysaradhi/design-system/tokens.css"`).
 * Reading it rather than hard-coding hexes is the point: a palette change moves
 * the numbers, and this file's assertions move with it.
 */
const TOKENS_CSS = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "design-system",
  "tokens.css",
);

type Tokens = Record<string, string>;

/** The `:root` block's `--name: value` pairs — the DEFAULT palette. */
function readRootTokens(): Tokens {
  const css = readFileSync(TOKENS_CSS, "utf8");
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css);
  if (root === null) throw new Error("tokens.css has no :root block");
  const tokens: Tokens = {};
  for (const line of root[1]!.split(";")) {
    const match = /--([a-z0-9-]+)\s*:\s*(.+)/.exec(line.trim());
    if (match !== null) tokens[match[1]!] = match[2]!.trim();
  }
  return tokens;
}

/** The measured contrast of two tokens against each other. */
function ratio(tokens: Tokens, a: string, b: string): number {
  const left = tokens[a];
  const right = tokens[b];
  if (left === undefined || right === undefined) {
    throw new Error(`token not found: ${a} / ${b}`);
  }
  return contrastRatio(hexToRgb(left), hexToRgb(right));
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

const WINDOW: PeriodWindow = {
  periodStartIso: "2026-10-01",
  periodEndIso: "2026-10-05",
  label: "October 2026",
  labelLower: "october 2026",
  movesMoneyCards: true,
};

function summary(): DashboardSummary {
  const kpis: DashboardKpis = {
    totalStudents: 87,
    studentsWithDues: 12,
    collectedThisMonthMinor: 12450000,
    dueTillDateMinor: 3820000,
    dueForMonthMinor: 1450000,
    overdueMinor: 900000,
    paymentBreakdown: { paid: 42, partial: 8, unpaid: 12 },
  };
  return {
    kpis,
    activity: [],
    dueToday: [],
    dueTodayTotal: 0,
    dueTodayTruncated: false,
    dataOrigin: "live",
  };
}

function renderClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardClient />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDashboardSummaryAction).mockResolvedValue({
    ok: true,
    value: { summary: summary(), window: WINDOW },
  });
});

/** The seven cards of the strip, in DOM order. */
function kpiCards(): HTMLElement[] {
  const container = document.querySelector('[aria-busy]');
  if (container === null) throw new Error("the KPI strip is not rendered");
  return Array.from(container.children) as HTMLElement[];
}

describe("PERF-4.6 — the KPI strip never strands a card", () => {
  it("tiles the six numbered cards evenly and gives the seventh the full row", async () => {
    renderClient();
    await waitFor(() => expect(screen.getByText("Collected")).toBeInTheDocument(), {
      timeout: 8000,
    });

    const container = document.querySelector('[aria-busy]') as HTMLElement;
    // The strip's breakpoints are unchanged: §6.3 still wants three across on
    // lg and six on 2xl.
    for (const cls of [
      "grid-cols-1",
      "sm:grid-cols-2",
      "lg:grid-cols-3",
      "2xl:grid-cols-6",
    ]) {
      expect(container.className.split(/\s+/)).toContain(cls);
    }

    const cards = kpiCards();
    expect(cards).toHaveLength(7);

    // The six numbered cards must fill WHOLE rows at every one of those
    // column counts — that is what "no orphan" means arithmetically.
    for (const count of [1, 2, 3, 6]) {
      expect(6 % count, `${count} columns leave a gap in the first six cards`).toBe(0);
    }

    // And the seventh spans the row it is on (`col-span-full` is `1 / -1`, so
    // it spans every column at every breakpoint).
    const spanning = cards.filter((card) => card.className.includes("col-span-full"));
    expect(spanning).toHaveLength(1);
    expect(spanning[0]).toBe(cards[6]);
    expect(spanning[0]?.textContent).toContain("Overdue");
  });

  it("keeps the last card's content readable across the band it now occupies", async () => {
    renderClient();
    await waitFor(() => expect(screen.getByText("Collected")).toBeInTheDocument(), {
      timeout: 8000,
    });

    const overdue = kpiCards()[6] as HTMLElement;
    // The band is a row at ≥sm, so the figure, the label and the caption sit
    // side by side rather than in a column of empty space.
    expect(overdue.className).toContain("sm:flex-row");
    expect(overdue.className).toContain("sm:items-center");
    // The scope sentence is still in the card: a tutor must still be able to
    // read what the figure covers (04 §6.4).
    expect(overdue.textContent).toContain(
      "Unpaid invoices already past their due date, all time",
    );
  });
});

describe("A11Y-4.7 — the KPI card's boundary clears 3 : 1", () => {
  it("uses the design system's boundary token, not a hand-tinted accent", async () => {
    renderClient();
    await waitFor(() => expect(screen.getByText("Collected")).toBeInTheDocument(), {
      timeout: 8000,
    });

    for (const card of kpiCards()) {
      const style = card.getAttribute("style") ?? "";
      expect(style).toContain("var(--border-strong)");
      // The 25 % tint is the defect: 1.38–1.40 : 1 on the card's surface.
      expect(style).not.toContain("25%");
      // §5.4's recipe: a 2 px left border in the semantic accent. The width is
      // read from the LEFT edge, whether the engine serialised it as the
      // longhand or expanded the shorthand into the four sides.
      const leftWidth =
        /border-left-width:\s*([^;]+)/.exec(style)?.[1]?.trim() ??
        /border-width:\s*([^;]+)/.exec(style)?.[1]?.trim().split(/\s+/)[3];
      expect(leftWidth).toBe("2px");
      expect(style).toMatch(/border-left-color: var\(--(success|warning|danger|info)\)/);
    }
  });

  it("measures the tokens it uses — the boundary and every accent clear 3 : 1", () => {
    const tokens = readRootTokens();
    const surface = "surface-raised";

    // The card's perimeter.
    expect(ratio(tokens, "border-strong", surface)).toBeGreaterThanOrEqual(3);

    // The 2 px semantic bar, in every accent the strip uses.
    for (const accent of ["success", "warning", "danger", "info"]) {
      expect(ratio(tokens, accent, surface), `${accent} left-bar`).toBeGreaterThanOrEqual(3);
    }

    // And the OLD construction, for the record: a 25 % tint of the accent over
    // the surface is what this change replaced, and it is below the floor.
    // The composite is sRGB alpha compositing — exactly what CSS's
    // `color-mix(in srgb, ACCENT 25%, transparent)` over the surface does.
    const tint = (accent: string) => {
      const a = hexToRgb(tokens[accent]!);
      const s = hexToRgb(tokens[surface]!);
      const mix = (channel: number, ground: number) =>
        Math.round(channel * 0.25 + ground * 0.75);
      return contrastRatio(
        { r: mix(a.r, s.r), g: mix(a.g, s.g), b: mix(a.b, s.b) },
        s,
      );
    };
    for (const accent of ["success", "warning", "danger", "info"]) {
      expect(tint(accent), `${accent} at 25 %`).toBeLessThan(3);
    }
  });
});
