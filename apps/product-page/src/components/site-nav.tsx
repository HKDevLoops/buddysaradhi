"use client";

// Implements: docs/design/overhaul-plan.md §4.1 (the front door has to work on a
// phone — this product's primary audience) + AGENTS.md §2 Rule 10 (keyboard
// parity, 44px targets, colour never the only signal).
//
// WHY THIS FILE EXISTS. The header nav used to render every link with
// `hidden text-sm md:inline`. Below 768px that made Pricing, Platforms and
// Screens unreachable from the header, and the footer that carries two of the
// three is a full page scroll away. A visitor on a phone had no route to the
// pricing table.
//
// WHAT IT IS. Below md a disclosure: a real <button> carrying `aria-expanded`
// and `aria-controls`, revealing a <nav> of real <Link>s. No CSS-only trick, so
// the expanded state is in the accessibility tree and not only in the paint.
//
// The desktop row and the mobile panel are two <nav> elements carrying the same
// label, and that is deliberate: the desktop row is `hidden md:flex` and the
// panel is `md:hidden`, so exactly one exists in the accessibility tree at any
// width (`hidden` removes an element from the a11y tree). A screen reader
// therefore never meets two "Primary" landmarks.
//
// State notes. The panel closes on selection, because Next keeps the root layout
// mounted across a client navigation and an open panel would otherwise follow
// the visitor onto /pricing. It closes on Escape from either the control or the
// panel. The icon swaps between bars and a cross as well as rotating, so the
// open state is not signalled by colour or motion alone. There is no transition
// to honour `prefers-reduced-motion`: globals.css already collapses every
// transition under that query, and a disclosure that snaps is not a motion
// defect.

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";

export interface SiteNavLink {
  readonly href: string;
  readonly label: string;
}

const PANEL_ID = "primary-sections";

function Bars() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="M3 6h14M3 10h14M3 14h14" />
    </svg>
  );
}

function Cross() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function SiteNav({ links }: { links: readonly SiteNavLink[] }) {
  const [open, setOpen] = useState(false);

  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && open) setOpen(false);
  };

  return (
    <>
      <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        onKeyDown={closeOnEscape}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border md:hidden"
        style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
      >
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        {open ? <Cross /> : <Bars />}
      </button>

      {/* Always rendered so `aria-controls` always resolves. `hidden` when
          closed, and `md:hidden` so a panel opened on a phone cannot survive a
          resize onto the desktop layout that already shows the same links. */}
      <nav
        id={PANEL_ID}
        aria-label="Primary"
        onKeyDown={closeOnEscape}
        className={`${open ? "flex" : "hidden"} w-full flex-col items-stretch border-t pt-1 md:hidden`}
        style={{ borderColor: "var(--border-default)" }}
      >
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setOpen(false)}
            className="inline-flex min-h-11 items-center border-b text-base last:border-b-0"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
