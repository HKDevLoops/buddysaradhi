// Implements: 07_Fees_and_Payments.md §6 (the Fees screen, the only surface
// allowed to write `ledger_entries`/`invoices`/`receipts`); AGENTS.md §2 Rule 4
// as amended 2026-10-07 — `/fees` is one of the five screen routes.
// 16_Platform_Delivery_Sequence.md §W1.
//
// THE ROUTE IS THE SCREEN. See `app/(app)/dashboard/page.tsx` for why each
// screen is its own `page.tsx`. This one is Fees & Payments.
//
// WHY THIS SCREEN IS SAFE TO SERVER-RENDER WHILE ATTENDANCE AND SETTINGS ARE NOT.
// `FeesClient` is allowed to render on the server because its first render does
// not depend on browser-only state. Its tab is a local `useState("ledger")`
// (components/fees/fees-client.tsx:99), not the store's persisted `mode`, and the
// only store value it reads before any user action — `selectedStudentId` — is not
// in the persisted slice (`stores/fees-store.ts:75-78` persists `mode` and
// `searchQuery` only). So the server's render and the browser's first render
// agree. `attendance-screen.tsx` and `settings-screen.tsx` document the two that
// cannot, and why.
//
// THE KEY IS LITERAL. `["fees-students", ""]` — the empty search string is part
// of the key, not an accident of this page: the screen's own query asks for the
// unfiltered roster and filters in the browser as the tutor types
// (components/fees/fees-client.tsx:105). `getStudentsForFees` returns the
// `{ success, data }` envelope the screen already reads, so the same call is
// both the server's prefetch and the screen's own query function.
//
// Money is untouched by this route: Rule 6 (integer paise) and Rule 1
// (append-only ledger) live in the ledger engine and the server actions, not in
// which page the screen is rendered from.

import type { Metadata } from "next";
import { ScreenData } from "../screen-data";
import { FeesClient } from "@/components/fees/fees-client";
import { getStudentsForFees } from "@/server/queries/fees";

// See `app/(app)/dashboard/page.tsx` for why every screen route declares its own
// title in the server HTML.
export const metadata: Metadata = {
  title: "Fees & Payments · BuddySaradhi",
};

export default async function FeesPage() {
  return (
    <ScreenData queries={[{ queryKey: ["fees-students", ""], queryFn: () => getStudentsForFees("") }]}>
      <FeesClient />
    </ScreenData>
  );
}