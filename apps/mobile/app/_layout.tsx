import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import '../global.css';

import { DatabaseProvider } from '../src/lib/db/provider';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    // Artificial delay for now, in a real app this would wait for fonts and DB
    setTimeout(() => {
      SplashScreen.hideAsync();
    }, 100);
  }, []);

  return (
    <DatabaseProvider>
      <ThemeProvider value={DarkTheme}>
        <View className="flex-1 bg-root">
        {/* Aurora Overlay mockup */}
        <View className="absolute inset-0 bg-cosmic opacity-4 pointer-events-none" />
        
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(modal)" options={{ presentation: 'formSheet' }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack>
      </View>
    </ThemeProvider>
    </DatabaseProvider>
  );
}
