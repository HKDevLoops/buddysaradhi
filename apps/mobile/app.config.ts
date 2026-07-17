import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Buddysaradhi',
  slug: 'buddysaradhi',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'buddysaradhi',
  userInterfaceStyle: 'dark',
  splash: {
    image: './assets/images/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#000000',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.buddysaradhi.app',
    infoPlist: {
      NSFaceIDUsageDescription: 'Allow Buddysaradhi to use Face ID for app unlock and recording sensitive actions.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#000000',
    },
    package: 'com.buddysaradhi.app',
    permissions: [
      'USE_BIOMETRIC',
      'USE_FINGERPRINT',
      'NOTIFICATIONS',
    ],
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-font',
      {
        fonts: [
          'node_modules/@expo-google-fonts/inter/Inter_400Regular.ttf',
          'node_modules/@expo-google-fonts/inter/Inter_500Medium.ttf',
          'node_modules/@expo-google-fonts/inter/Inter_600SemiBold.ttf',
          'node_modules/@expo-google-fonts/inter/Inter_700Bold.ttf',
        ],
      },
    ],
    'expo-local-authentication',
    'expo-secure-store',
    'expo-sharing',
    [
      'expo-sqlite',
      {
        enableFTS: true,
      }
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
});
