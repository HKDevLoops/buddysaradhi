// Implements: docs/design/overhaul-plan.md §6 — Attendance on the token system.
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AttendanceRow,
  type AttendanceStatus,
} from "../../src/components/attendance/attendance-row";
import { useThemeStyles } from "../../src/theme/styles";

const BATCHES = ["10-Sci", "10-Math", "9-Sci", "11-Phys", "12-Chem"];
const DATES = [
  { day: "Mon", date: "21" },
  { day: "Tue", date: "22" },
  { day: "Wed", date: "23" },
  { day: "Thu", date: "24", current: true },
  { day: "Fri", date: "25" },
];

const MOCK_STUDENTS = [
  { id: "1", name: "Aarav Sharma" },
  { id: "2", name: "Diya Patel" },
  { id: "3", name: "Rohan Gupta" },
  { id: "4", name: "Sneha Reddy" },
  { id: "5", name: "Kabir Singh" },
];

export default function AttendanceScreen() {
  const insets = useSafeAreaInsets();
  const s = useThemeStyles();
  const [selectedBatch, setSelectedBatch] = useState<string>(BATCHES[0] ?? "");
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});

  const handleStatusChange = (id: string, status: AttendanceStatus) => {
    setAttendance((prev) => ({ ...prev, [id]: status }));
  };

  const markAllPresent = () => {
    const next: Record<string, AttendanceStatus> = {};
    for (const student of MOCK_STUDENTS) next[student.id] = "present";
    setAttendance(next);
  };

  return (
    <View className="flex-1" style={s.bg.canvas}>
      <View className="px-4 pt-6 z-10">
        <Text className="text-xl font-bold tracking-tight mb-4" style={s.fg.primary}>
          Attendance
        </Text>

        <View className="flex-row justify-between mb-6">
          {DATES.map((entry) => (
            <Pressable key={entry.date} className="items-center">
              <Text className="text-xs mb-1" style={entry.current ? s.accent.info : s.fg.muted}>
                {entry.day}
              </Text>
              <View
                className={`w-12 h-12 rounded-full items-center justify-center border ${
                  entry.current ? "" : ""
                }`}
                style={[
                  entry.current ? s.bg.inset : s.bg.row,
                  entry.current ? s.border.edge : s.border.hairline,
                ]}
              >
                <Text className="font-bold" style={entry.current ? s.accent.info : s.fg.secondary}>
                  {entry.date}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mb-2"
          style={{ maxHeight: 40, minHeight: 40 }}
        >
          {BATCHES.map((batch) => {
            const selected = selectedBatch === batch;
            return (
              <Pressable
                key={batch}
                onPress={() => setSelectedBatch(batch)}
                className="mr-3 px-4 py-2 rounded-full border"
                style={[selected ? s.bg.raised : s.bg.canvas, s.border.hairline]}
              >
                <Text className="font-medium" style={selected ? s.fg.primary : s.fg.muted}>
                  {batch}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View className="flex-row items-center justify-between px-4 py-3 border-b" style={s.border.hairline}>
        <Text className="text-sm" style={s.fg.secondary}>
          {MOCK_STUDENTS.length} Students in {selectedBatch}
        </Text>
        <Pressable onPress={markAllPresent}>
          <Text className="text-sm font-medium" style={s.accent.success}>
            Mark All Present
          </Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {MOCK_STUDENTS.map((student) => (
          <AttendanceRow
            key={student.id}
            studentName={student.name}
            status={attendance[student.id] ?? "none"}
            onStatusChange={(status) => handleStatusChange(student.id, status)}
          />
        ))}
      </ScrollView>

      <View className="absolute left-4 right-4" style={{ bottom: 20 + insets.bottom }}>
        <Pressable
          className="rounded-2xl p-4 items-center active:opacity-80 border"
          style={[s.bg.raised, s.border.focus]}
        >
          <Text className="font-bold text-lg" style={s.accent.info}>
            Save Attendance
          </Text>
        </Pressable>
      </View>
    </View>
  );
}