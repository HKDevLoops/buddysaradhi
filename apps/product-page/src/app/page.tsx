import React from "react";
import { Hero3D } from "@/components/hero/Hero3D";
import { seedAdminUser } from "../lib/seedAdmin";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  try {
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      await seedAdminUser();
    }
  } catch (error) {
    console.warn("Failed to seed admin user (expected during build or serverless init):", error);
  }

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[var(--bg-cosmic)] text-[var(--text-primary)]">
      {/* 3D Story Canvas takes over completely */}
      <Hero3D />
    </main>
  );
}
