"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useShellStore } from "@/stores/shell-store";

const DashboardClient = dynamic(
  () => import("@/components/buddysaradhi/dashboard-client").then((m) => m.DashboardClient),
  { ssr: false }
);
const StudentsClient = dynamic(
  () => import("@/components/students/students-client").then((m) => m.StudentsClient),
  { ssr: false }
);
const AttendanceClient = dynamic(
  () => import("@/components/attendance/attendance-client").then((m) => m.AttendanceClient),
  { ssr: false }
);
const FeesClient = dynamic(
  () => import("@/components/fees/fees-client").then((m) => m.FeesClient),
  { ssr: false }
);
const SettingsClient = dynamic(
  () => import("@/components/settings/settings-client").then((m) => m.SettingsClient),
  { ssr: false }
);

export default function AppRouter() {
  const activeScreen = useShellStore((state) => state.activeScreen);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 h-full flex flex-col">
      {activeScreen === "/dashboard" && <DashboardClient />}
      {activeScreen === "/students" && <StudentsClient />}
      {activeScreen === "/attendance" && <AttendanceClient />}
      {activeScreen === "/fees" && <FeesClient />}
      {activeScreen === "/settings" && <SettingsClient />}
    </div>
  );
}
