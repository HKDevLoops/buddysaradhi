// Implements: docs/design/overhaul-plan.md §4.1 (`/platforms`: the web, mobile
// and desktop matrix) with the honesty rule applied: only the web app ships
// today. The mobile and desktop clients are in progress under
// 16_Platform_Delivery_Sequence.md and are described as such, with no download
// links and no claim of a release that does not exist.

import Link from "next/link";

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
      "In development. The same five screens and the same ledger, built for one hand and a bright phone. No build is published yet.",
  },
  {
    name: "iOS",
    status: "in-progress",
    builtWith: "Expo, React Native",
    today:
      "In development, built from the same codebase as Android. No build is published yet.",
  },
  {
    name: "macOS",
    status: "in-progress",
    builtWith: "Tauri, native window",
    today:
      "In development. A desktop window over the same web app, with your data in a local encrypted database. No build is published yet.",
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
        <p className="max-w-[52ch] text-pretty text-[var(--text-secondary)]">
          If a particular platform is the reason you are here, say so in your access request. It goes
          to the same person who provisions your account.
        </p>
        <Link href="/request-access" className="btn btn-primary">
          Request access
        </Link>
      </div>
    </div>
  );
}