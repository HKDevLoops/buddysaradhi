"use client";

import React from "react";
import { useShellStore } from "@/stores/shell-store";
import { DashboardClient } from "@/components/buddysaradhi/dashboard-client";
import { StudentsClient } from "@/components/students/students-client";
import { AttendanceClient } from "@/components/attendance/attendance-client";
import { FeesClient } from "@/components/fees/fees-client";
import { SettingsClient } from "@/components/settings/settings-client";

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
