import React, { useState, useMemo } from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { NeumoInput } from '../../src/components/ui/neumo-input';
import { GlassCard } from '../../src/components/ui/glass-card';
import { StudentRow, StudentRowProps } from '../../src/components/students/student-row';

// Dummy data generator
const generateStudents = (count: number): StudentRowProps[] => {
  const grades = ['10-Sci', '10-Math', '9-Sci', '9-Math', '11-Phys'];
  const statuses = ['paid', 'partial', 'unpaid', 'inactive'] as const;
  
  return Array.from({ length: count }).map((_, i) => ({
    id: `STU-${i}`,
    name: `Student ${i + 1}`,
    grade: grades[Math.floor(Math.random() * grades.length)],
    guardianPhone: '9876543210',
    balanceMinor: Math.random() > 0.6 ? Math.floor(Math.random() * 500000) : 0,
    status: statuses[Math.floor(Math.random() * statuses.length)],
    lastAttendance: Math.random() > 0.2 ? 'Today' : 'Yesterday',
    onPress: () => console.log(`Pressed STU-${i}`)
  }));
};

export default function StudentsScreen() {
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  
  // Memoize data for FlashList performance
  const allStudents = useMemo(() => generateStudents(50), []);
  
  const filteredStudents = useMemo(() => {
    if (!searchQuery) return allStudents;
    const lowerQ = searchQuery.toLowerCase();
    return allStudents.filter(s => 
      s.name.toLowerCase().includes(lowerQ) || 
      s.grade.toLowerCase().includes(lowerQ)
    );
  }, [searchQuery, allStudents]);

  return (
    <View className="flex-1">
      {/* Header & Search */}
      <View className="px-4 pt-6 pb-2 z-10 bg-[#0C081A]">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-white text-xl font-bold tracking-tight">Students</Text>
          <GlassCard intensity="strong" className="w-8 h-8 rounded-full items-center justify-center">
            <Text className="text-white font-bold text-lg leading-5">+</Text>
          </GlassCard>
        </View>
        <NeumoInput
          placeholder="Search by name, grade, or phone..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          className="mb-2"
        />
        <View className="flex-row items-center justify-between mt-2 px-1">
          <Text className="text-white/40 text-xs">{filteredStudents.length} students</Text>
          <Text className="text-[#00F0FF] text-xs font-medium">Filter ▾</Text>
        </View>
      </View>

      {/* List */}
      <View className="flex-1 mt-2">
        <FlashList
          data={filteredStudents}
          renderItem={({ item }) => <StudentRow {...item} />}
          estimatedItemSize={77}
          contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
          showsVerticalScrollIndicator={true}
          indicatorStyle="white"
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-20">
              <Text className="text-white/40 text-base">No students found.</Text>
            </View>
          }
        />
      </View>
    </View>
  );
}
