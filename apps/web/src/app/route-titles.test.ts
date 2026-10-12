// Implements: AGENTS.md §2 Rule 4 as amended 2026-10-07 (per-route `<title>`
// in the server HTML) — black-box probe B1 (every route served the identical
// root-layout title).
//
// Every route that owns a `<title>` is pinned here: the five app screens (the
// Dashboard's own test pins its prefetch contract; the title half lives here
// alongside the rest) plus the four auth routes and the provision route. The
// 404's title lives in `not-found-title.test.tsx` — `not-found.tsx` cannot
// export `metadata` (Next only reads `layout`/`page`), so its title is a
// React 19 `<title>` element asserted from rendered markup instead.
//
// Child components are stubbed: this file asserts the ROUTES' contract (which
// title each declares), not what the screens render.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";

vi.mock("./(app)/screen-data", () => ({
  ScreenData: () => createElement("div", { "data-testid": "screen-data" }),
}));

vi.mock("@/components/buddysaradhi/dashboard-client", () => ({
  DashboardClient: () => createElement("div"),
}));
vi.mock("@/server/actions/dashboard", () => ({
  fetchDashboardSummaryAction: async () => ({ ok: true, value: {} }),
  fetchDashboardAnalyticsAction: async () => ({ ok: true, value: {} }),
}));

vi.mock("@/components/attendance/attendance-client", () => ({
  AttendanceClient: () => createElement("div"),
}));

vi.mock("@/components/students/students-client", () => ({
  StudentsClient: () => createElement("div"),
}));
vi.mock("@/server/actions/students", () => ({
  fetchStudentsAction: async () => ({ ok: true, value: {} }),
}));
vi.mock("@/stores/students-store", () => ({
  useStudentsStore: {
    getInitialState: () => ({
      filters: {},
      searchQuery: "",
      page: 1,
      pageSize: 20,
      sort: { col: "name", dir: "asc" },
    }),
  },
}));

vi.mock("@/components/fees/fees-client", () => ({
  FeesClient: () => createElement("div"),
}));
vi.mock("@/server/queries/fees", () => ({
  getStudentsForFees: async () => ({ ok: true, data: {} }),
}));

vi.mock("@/components/settings/settings-client", () => ({
  SettingsClient: () => createElement("div"),
}));
vi.mock("@/server/queries/settings", () => ({
  getSettings: async () => ({ ok: true, data: {} }),
}));

vi.mock("./(auth)/login/login-form", () => ({
  default: () => createElement("div"),
}));
vi.mock("./(auth)/signup/signup-form", () => ({
  default: () => createElement("div"),
}));
vi.mock("./(auth)/forgot-password/forgot-password-form", () => ({
  default: () => createElement("div"),
}));
vi.mock("./(auth)/reset-password/reset-password-form", () => ({
  default: () => createElement("div"),
}));
vi.mock("./(auth)/signup/provision/provision-client", () => ({
  default: () => createElement("div"),
}));

const { metadata: dashboardMeta } = await import("./(app)/dashboard/page");
const { metadata: studentsMeta } = await import("./(app)/students/page");
const { metadata: attendanceMeta } = await import("./(app)/attendance/page");
const { metadata: feesMeta } = await import("./(app)/fees/page");
const { metadata: settingsMeta } = await import("./(app)/settings/page");
const { metadata: loginMeta } = await import("./(auth)/login/page");
const { metadata: signupMeta } = await import("./(auth)/signup/page");
const { metadata: forgotMeta } = await import("./(auth)/forgot-password/page");
const { metadata: resetMeta } = await import("./(auth)/reset-password/page");
const { metadata: provisionMeta } = await import("./(auth)/signup/provision/page");

const TITLES = {
  dashboard: dashboardMeta.title,
  students: studentsMeta.title,
  attendance: attendanceMeta.title,
  fees: feesMeta.title,
  settings: settingsMeta.title,
  login: loginMeta.title,
  signup: signupMeta.title,
  forgotPassword: forgotMeta.title,
  resetPassword: resetMeta.title,
  provision: provisionMeta.title,
} as const;

describe("per-route <title> (probe B1)", () => {
  it("gives every app screen its own title", () => {
    expect(TITLES.dashboard).toBe("Dashboard · BuddySaradhi");
    expect(TITLES.students).toBe("Students · BuddySaradhi");
    expect(TITLES.attendance).toBe("Attendance · BuddySaradhi");
    expect(TITLES.fees).toBe("Fees & Payments · BuddySaradhi");
    expect(TITLES.settings).toBe("Settings · BuddySaradhi");
  });

  it("gives every auth route its own title", () => {
    expect(TITLES.login).toBe("Sign in · BuddySaradhi");
    expect(TITLES.signup).toBe("Create account · BuddySaradhi");
    expect(TITLES.forgotPassword).toBe("Forgot password · BuddySaradhi");
    expect(TITLES.resetPassword).toBe("Reset password · BuddySaradhi");
    expect(TITLES.provision).toBe("Setting up workspace · BuddySaradhi");
  });

  it("serves no two routes the same title", () => {
    const values = Object.values(TITLES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("brands every title with the product name", () => {
    for (const [route, title] of Object.entries(TITLES)) {
      expect(String(title), route).toContain("BuddySaradhi");
    }
  });
});
