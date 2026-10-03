import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import "../global.css";

import { DatabaseProvider } from "../src/lib/db/provider";
import { AppearanceProvider } from "../src/theme/appearance";
import { useThemeStyles } from "../src/theme/styles";

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

/**
 * The canvas is the ONE token-painted surface in the shell. Every screen sits on
 * top of it, so a palette change repaints the whole app from a single value
 * instead of asking each screen to know the active palette.
 */
function Shell() {
  const s = useThemeStyles();
  return (
    <View className="flex-1" style={s.bg.canvas}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(modal)" options={{ presentation: "formSheet" }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Artificial delay for now, in a real app this would wait for fonts and DB
    setTimeout(() => {
      SplashScreen.hideAsync();
    }, 100);
  }, []);

  return (
    <AppearanceProvider>
      <DatabaseProvider>
        <ThemeProvider value={DarkTheme}>
          <Shell />
        </ThemeProvider>
      </DatabaseProvider>
    </AppearanceProvider>
  );
}