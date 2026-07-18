import React from "react";
import { GlassShell } from "@/components/buddysaradhi/glass-shell";
import { AutoProvisionGuard } from "@/hooks/use-auto-provision";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <GlassShell>
      {/* Auto-heals DB_NOT_PROVISIONED errors silently — Rule 9 compliance */}
      <AutoProvisionGuard />
      {children}
    </GlassShell>
  );
}
