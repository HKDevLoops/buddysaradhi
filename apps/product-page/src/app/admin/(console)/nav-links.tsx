// Implements: docs/design/overhaul-plan.md §4.2 — the console side nav.
//
// The one client component in the console, and the only reason for it: a Server
// Component cannot read its own pathname, and a nav link without `aria-current`
// misleads a screen reader about where it is. Nothing else here is interactive
// beyond ordinary link navigation.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS: ReadonlyArray<{ readonly href: string; readonly label: string }> = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/requests", label: "Requests" },
  { href: "/admin/subscriptions", label: "Subscriptions" },
  { href: "/admin/entitlements", label: "Entitlements" },
  { href: "/admin/exports", label: "Exports" },
  { href: "/admin/reminders", label: "Reminders" },
  { href: "/admin/audit", label: "Audit" },
];

function isCurrent(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="adm-nav-list">
      {NAV_ITEMS.map((item) => (
        <li key={item.href}>
          <Link className="adm-nav-link" href={item.href} aria-current={isCurrent(item.href, pathname) ? "page" : undefined}>
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}