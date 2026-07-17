"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { PaletteProvider } from "@/lib/palette-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: (failCount, err) =>
              err.message === "UNAUTHENTICATED" ? false : failCount < 2,
            refetchOnWindowFocus: true,
          },
        },
      })
  );
  
  return (
    <QueryClientProvider client={client}>
      <PaletteProvider>{children}</PaletteProvider>
    </QueryClientProvider>
  );
}
