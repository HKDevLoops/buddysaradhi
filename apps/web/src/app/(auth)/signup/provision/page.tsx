import type { Metadata } from "next";
import ProvisionClient from "./provision-client";

// Implements: 18_Microservice_Architecture.md — provision-db client +
// web/03_Auth_and_Provisioning.md §3.4; AGENTS.md §2 Rule 4 as amended
// 2026-10-07 — per-route `<title>` in the server HTML (black-box probe B1;
// see app/(app)/dashboard/page.tsx).
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Setting up workspace · BuddySaradhi",
};

export default function ProvisionPage() {
  return <ProvisionClient />;
}
