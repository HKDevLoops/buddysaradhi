import React from "react";
import { GlassShell } from "@/components/buddysaradhi/glass-shell";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <GlassShell>
      {children}
    </GlassShell>
  );
}
