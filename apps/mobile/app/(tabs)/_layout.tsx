import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { View, Platform } from 'react-native';

function TabBarBackground() {
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={24}
        tint="dark"
        className="absolute inset-0 bg-white/6 border-t border-white/8"
      />
    );
  }
  return <View className="absolute inset-0 bg-black/40 border-t border-white/8" />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
        },
        tabBarBackground: () => <TabBarBackground />,
        tabBarActiveTintColor: '#00FF9D',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.40)',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="students" options={{ title: 'Students' }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Tabs.Screen name="fees" options={{ title: 'Fees' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
