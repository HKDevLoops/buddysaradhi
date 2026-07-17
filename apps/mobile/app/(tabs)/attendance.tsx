import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// GlassCard import removed
import { AttendanceRow, AttendanceStatus } from '../../src/components/attendance/attendance-row';

const BATCHES = ['10-Sci', '10-Math', '9-Sci', '11-Phys', '12-Chem'];
const DATES = [
  { day: 'Mon', date: '21' },
  { day: 'Tue', date: '22' },
  { day: 'Wed', date: '23' },
  { day: 'Thu', date: '24', current: true },
  { day: 'Fri', date: '25' },
];

const MOCK_STUDENTS = [
  { id: '1', name: 'Aarav Sharma' },
  { id: '2', name: 'Diya Patel' },
  { id: '3', name: 'Rohan Gupta' },
  { id: '4', name: 'Sneha Reddy' },
  { id: '5', name: 'Kabir Singh' },
];

export default function AttendanceScreen() {
  const insets = useSafeAreaInsets();
  const [selectedBatch, setSelectedBatch] = useState(BATCHES[0]);
  const [attendanceState, setAttendanceState] = useState<Record<string, AttendanceStatus>>({});

  const handleStatusChange = (id: string, status: AttendanceStatus) => {
    setAttendanceState(prev => ({ ...prev, [id]: status }));
  };

  const markAllPresent = () => {
    const newState: Record<string, AttendanceStatus> = {};
    MOCK_STUDENTS.forEach(s => {
      newState[s.id] = 'present';
    });
    setAttendanceState(newState);
  };

  return (
    <View className="flex-1 bg-[#0C081A]">
      <View className="px-4 pt-6 z-10">
        <Text className="text-white text-xl font-bold tracking-tight mb-4">Attendance</Text>
        
        {/* Date Ribbon */}
        <View className="flex-row justify-between mb-6">
          {DATES.map((d, i) => (
            <Pressable key={i} className="items-center">
              <Text className={`text-xs mb-1 ${d.current ? 'text-[#00F0FF]' : 'text-white/40'}`}>{d.day}</Text>
              <View className={`w-12 h-12 rounded-full items-center justify-center ${d.current ? 'bg-[#00F0FF]/20 border border-[#00F0FF]/50' : 'bg-white/5'}`}>
                <Text className={`font-bold ${d.current ? 'text-[#00F0FF]' : 'text-white/60'}`}>{d.date}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Batch Ribbon */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2" style={{ maxHeight: 40, minHeight: 40 }}>
          {BATCHES.map(b => (
            <Pressable 
              key={b} 
              onPress={() => setSelectedBatch(b)}
              className={`mr-3 px-4 py-2 rounded-full border ${selectedBatch === b ? 'bg-white/10 border-white/20' : 'bg-transparent border-white/5'}`}
            >
              <Text className={`font-medium ${selectedBatch === b ? 'text-white' : 'text-white/40'}`}>{b}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View className="flex-row items-center justify-between px-4 py-3 border-b border-white/5">
        <Text className="text-white/60 text-sm">5 Students in {selectedBatch}</Text>
        <Pressable onPress={markAllPresent}>
          <Text className="text-[#00FF9D] text-sm font-medium">Mark All Present</Text>
        </Pressable>
      </View>

      {/* Student List */}
      <ScrollView 
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {MOCK_STUDENTS.map(student => (
          <AttendanceRow 
            key={student.id}
            studentName={student.name}
            status={attendanceState[student.id] || 'none'}
            onStatusChange={(status) => handleStatusChange(student.id, status)}
          />
        ))}
      </ScrollView>

      {/* Floating Save Button */}
      <View 
        className="absolute left-4 right-4" 
        style={{ bottom: 20 + insets.bottom }}
      >
        <Pressable className="bg-[#00F0FF] rounded-2xl p-4 shadow-[0_0_20px_rgba(0,240,255,0.3)] items-center active:opacity-80">
          <Text className="text-[#0C081A] font-bold text-lg">Save Attendance</Text>
        </Pressable>
      </View>
    </View>
  );
}
