// Implements: docs/design/overhaul-plan.md §6 — Students on the token system.
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";

import { NeumoInput } from "../../src/components/ui/neumo-input";
import { GlassCard } from "../../src/components/ui/glass-card";
import { StudentRow } from "../../src/components/students/student-row";
import type { StudentRowProps } from "../../src/components/students/student-row";
import { useThemeStyles } from "../../src/theme/styles";

const generateStudents = (count: number): StudentRowProps[] => {
  const grades = ["10-Sci", "10-Math", "9-Sci", "9-Math", "11-Phys"];
  const statuses = ["paid", "partial", "unpaid", "inactive"] as const;

  return Array.from({ length: count }).map((_, i) => ({
    id: `STU-${i}`,
    name: `Student ${i + 1}`,
    grade: grades[Math.floor(Math.random() * grades.length)],
    guardianPhone: "9876543210",
    balanceMinor: Math.random() > 0.6 ? Math.floor(Math.random() * 500000) : 0,
    status: statuses[Math.floor(Math.random() * statuses.length)],
    lastAttendance: Math.random() > 0.2 ? "Today" : "Yesterday",
    onPress: () => undefined,
  }));
};

export default function StudentsScreen() {
  const insets = useSafeAreaInsets();
  const s = useThemeStyles();
  const [searchQuery, setSearchQuery] = useState("");

  const allStudents = useMemo(() => generateStudents(50), []);

  const filteredStudents = useMemo(() => {
    if (!searchQuery) return allStudents;
    const needle = searchQuery.toLowerCase();
    return allStudents.filter(
      (student) =>
        student.name.toLowerCase().includes(needle) || student.grade.toLowerCase().includes(needle),
    );
  }, [searchQuery, allStudents]);

  return (
    <View className="flex-1">
      <View className="px-4 pt-6 pb-2 z-10" style={s.bg.canvas}>
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-xl font-bold tracking-tight" style={s.fg.primary}>
            Students
          </Text>
          <GlassCard intensity="strong" className="w-8 h-8 rounded-full items-center justify-center">
            <Text className="font-bold text-lg leading-5" style={s.fg.primary}>
              +
            </Text>
          </GlassCard>
        </View>
        <NeumoInput
          placeholder="Search by name, grade, or phone..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          className="mb-2"
        />
        <View className="flex-row items-center justify-between mt-2 px-1">
          <Text className="text-xs" style={s.fg.muted}>
            {filteredStudents.length} students
          </Text>
          <Text className="text-xs font-medium" style={s.accent.info}>
            Filter ▾
          </Text>
        </View>
      </View>

      <View className="flex-1 mt-2">
        <FlashList
          data={filteredStudents}
          renderItem={({ item }) => <StudentRow {...item} />}
          contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
          showsVerticalScrollIndicator
          indicatorStyle="white"
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-20">
              <Text className="text-base" style={s.fg.muted}>
                No students found.
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}