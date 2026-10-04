// Implements: docs/design/overhaul-plan.md §4.1 (`/platforms`: the web, mobile
// and desktop matrix) with the honesty rule applied: only the web app ships
// today. The mobile and desktop clients are in progress under
// 16_Platform_Delivery_Sequence.md and are described as such, with no download
// links and no claim of a release that does not exist.
// Claims-audit pass (docs/design/marketing-claims-audit.md row 7): the unbuilt
// clients no longer borrow the web build's capability list. "The same five
// screens and the same ledger" and "your data in a local encrypted database"
// described apps/mobile and apps/desktop, which are scaffolds held behind
// WEB-PROD-GATE (AGENTS.md §3.1, §9.3) — they share the design system and the
// data model, and nothing else yet. The call to action now offers only what
// actually runs, in the same words the rest of the front door uses (§4.1).

import Link from "next/link";
import { APP_SIGNUP_URL, CONTRACTED_PLAN_CTA, FREE_SIGNUP_CTA, FREE_SIGNUP_NOTE } from "@/lib/access-request";

export const metadata = {
  title: "Platforms. BuddySaradhi.",
  description:
    "Where BuddySaradhi runs today. The web app is the current surface. Android, iOS, macOS and Windows are in progress.",
};

type PlatformStatus = "available" | "in-progress";

interface PlatformDefinition {
  readonly name: string;
  readonly status: PlatformStatus;
  readonly builtWith: string;
  readonly today: string;
}

const PLATFORMS: readonly PlatformDefinition[] = [
  {
    name: "Web",
    status: "available",
    builtWith: "Next.js on the browser",
    today:
      "The current surface. Every screen, every engine, the ledger and backups. Sign in from any browser, and it keeps working on a weak connection because writes land locally first.",
  },
  {
    name: "Android",
    status: "in-progress",
    builtWith: "Expo, React Native",
    today:
      "In development on the same design system and the same data model, built for one hand and a bright phone. None of those screens are finished. No build is published yet.",
  },
  {
    name: "iOS",
    status: "in-progress",
    builtWith: "Expo, React Native",
    today:
      "In development, from the same codebase as Android. No build is published yet.",
  },
  {
    name: "macOS",
    status: "in-progress",
    builtWith: "Tauri, native window",
    today:
      "In development. The plan is a desktop window over this same web app. No build is published yet.",
  },
  {
    name: "Windows",
    status: "in-progress",
    builtWith: "Tauri, native window",
    today:
      "In development, from the same desktop codebase as macOS. No build is published yet.",
  },
] as const;

const STATUS_LABEL: Readonly<Record<PlatformStatus, string>> = {
  available: "Available now",
  "in-progress": "In progress",
};

export default function PlatformsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-16">
      <header className="max-w-[68ch]">
        <h1 className="font-display text-3xl font-bold text-balance md:text-5xl">
          Where it runs today.
        </h1>
        <p className="mt-5 text-pretty text-lg text-[var(--text-secondary)]">
          One product, one ledger, shared code across every client. The web app is the surface that
          ships. The mobile and desktop clients are being built on the same code, and we will not
          pretend otherwise.
        </p>
      </header>

      <div role="region" aria-label="Platforms and their status" tabIndex={0} className="mt-10">
        <ul className="overflow-hidden rounded-panel border border-[var(--border-default)]">
          {PLATFORMS.map((p) => (
            <li
              key={p.name}
              className="row grid gap-2 px-5 py-5 md:grid-cols-[11rem_9rem_1fr] md:gap-6"
            >
              <span className="font-display text-lg font-semibold">{p.name}</span>
              <span
                className="inline-flex h-fit items-center gap-2 rounded-full px-3 py-1 text-sm font-medium"
                style={{
                  // Status is never colour alone: the label carries the meaning.
                  background: "var(--surface-inset)",
                  color: p.status === "available" ? "var(--accent-primary)" : "var(--text-secondary)",
                  border: `1px solid ${p.status === "available" ? "var(--accent-primary)" : "var(--border-default)"}`,
                }}
              >
                {STATUS_LABEL[p.status]}
                <span className="sr-only">
                  {p.status === "available"
                    ? ". You can use this today."
                    : ". Not released yet."}
                </span>
              </span>
              <span>
                <span className="block text-[var(--text-secondary)]">{p.today}</span>
                <span className="mt-1 block text-sm text-[var(--text-muted)]">
                  Built with {p.builtWith}.
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel mt-12 flex flex-col items-start gap-4 p-8 md:flex-row md:items-center md:justify-between">
        <div className="max-w-[52ch]">
          <p className="text-pretty text-[var(--text-secondary)]">
            The web app is the only client running today, so it is the only one we will ask you to
            start with. If another platform is the reason you are here, the free plan gets you in
            now, and a contracted-plan request tells us which platform to build next.
          </p>
        </div>
        {/* One primary, and it is the thing that actually runs. Same words as `/`
            and `/pricing` (docs/design/marketing-claims-audit.md §4.1). */}
        <div className="flex w-full flex-col items-start gap-2 md:w-auto md:items-stretch">
          <a href={APP_SIGNUP_URL} className="btn btn-primary text-base" rel="noopener">
            {FREE_SIGNUP_CTA}
          </a>
          <p className="text-sm text-pretty text-[var(--text-muted)]">{FREE_SIGNUP_NOTE}</p>
          <Link href="/request-access" className="action inline-flex min-h-[44px] items-center">
            {CONTRACTED_PLAN_CTA}
          </Link>
        </div>
      </div>
    </div>
  );
}