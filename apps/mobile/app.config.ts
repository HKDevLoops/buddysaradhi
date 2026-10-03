// Implements: docs/design/overhaul-plan.md §6 — Expo config, with every colour
// read from the token contract instead of typed in.
//
// The splash screen and the Android adaptive icon are OS-owned surfaces that
// exist before any React tree is mounted, so they cannot read a theme context.
// Reading the generated token module here is the only way for them to follow the
// palette: the same source every other platform reads.
//
// Regenerate the tokens first: node apps/mobile/scripts/generate-tokens.mjs
import type { ConfigContext, ExpoConfig } from "expo/config";

import { DEFAULT_MATERIAL_ID, DEFAULT_PALETTE_ID, resolveTheme } from "./src/theme/tokens";

const tokens = resolveTheme(DEFAULT_PALETTE_ID, DEFAULT_MATERIAL_ID);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Buddysaradhi",
  slug: "buddysaradhi",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "buddysaradhi",
  userInterfaceStyle: "dark",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.buddysaradhi.app",
    infoPlist: {
      NSFaceIDUsageDescription:
        "Allow Buddysaradhi to use Face ID for app unlock and recording sensitive actions.",
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: tokens.colors.canvas,
    },
    package: "com.buddysaradhi.app",
    permissions: ["USE_BIOMETRIC", "USE_FINGERPRINT", "NOTIFICATIONS"],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-font",
      {
        fonts: [
          "node_modules/@expo-google-fonts/inter/Inter_400Regular.ttf",
          "node_modules/@expo-google-fonts/inter/Inter_500Medium.ttf",
          "node_modules/@expo-google-fonts/inter/Inter_600SemiBold.ttf",
          "node_modules/@expo-google-fonts/inter/Inter_700Bold.ttf",
        ],
      },
    ],
    "expo-local-authentication",
    "expo-secure-store",
    "expo-sharing",
    [
      "expo-splash-screen",
      {
        backgroundColor: tokens.colors.canvas,
        image: "./assets/images/splash-icon.png",
        resizeMode: "contain",
        imageWidth: 76,
      },
    ],
    [
      "expo-sqlite",
      {
        enableFTS: true,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
});
