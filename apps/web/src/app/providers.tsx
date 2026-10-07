"use client";

// Implements: AGENTS.md §3.3 (web stack snapshot) — the root client tree: the
// browser's one `QueryClient`, the palette, and the toast surface.
//
// The cache POLICY lives in `@/app/query-defaults`, not here. Each screen route's
// Server Component prefetches into a per-request client, and a dehydrated query
// is only trusted by this client if both run the same `staleTime` — two copies
// of these numbers would let the server emit data this client immediately
// discards. See `query-defaults.ts` for the reasoning.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { QUERY_DEFAULT_OPTIONS } from "@/app/query-defaults";
import { PaletteProvider } from "@/lib/palette-provider";
import { Toaster } from "@/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  // `useState`, not a module singleton: React calls this once per React tree, so
  // the server gets a fresh cache per request and the browser gets one cache for
  // the life of the tab. A module-level client would share one cache across
  // concurrent requests — a tutor's roster in another's HTML.
  const [client] = useState(() => new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS }));

  return (
    <QueryClientProvider client={client}>
      <PaletteProvider>
        {children}
        <Toaster />
      </PaletteProvider>
    </QueryClientProvider>
  );
}
