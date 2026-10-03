// Implements: docs/design/overhaul-plan.md §6 — the tab bar is a floating
// surface, so it is the one place on mobile allowed a material
// (material-modes.md §5.2: at most one translucent region, the nav).
import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { Platform, View } from "react-native";

import { useThemeStyles } from "../../src/theme/styles";

function TabBarBackground() {
  const s = useThemeStyles();
  if (s.material.translucent && Platform.OS === "ios") {
    return (
      <BlurView
        intensity={s.blur.intensity}
        tint={s.blur.tint}
        className="absolute inset-0"
        style={[s.bg.nav, s.border.hairline]}
      />
    );
  }
  // Reduce Transparency, battery saver, Android, and the Minimal mode all land
  // here: the opaque nav token, never a guess.
  return <View className="absolute inset-0" style={[s.bg.nav, s.border.hairline]} />;
}

export default function TabsLayout() {
  const s = useThemeStyles();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: "transparent",
          borderTopWidth: 0,
          elevation: 0,
        },
        tabBarBackground: () => <TabBarBackground />,
        tabBarActiveTintColor: s.color.accentPrimary,
        tabBarInactiveTintColor: s.color.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard" }} />
      <Tabs.Screen name="students" options={{ title: "Students" }} />
      <Tabs.Screen name="attendance" options={{ title: "Attendance" }} />
      <Tabs.Screen name="fees" options={{ title: "Fees" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}