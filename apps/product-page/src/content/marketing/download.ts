export interface DownloadPlatform {
  id: string;
  eyebrow: string;
  accent: "emerald" | "cyan";
  pitch: string;
  primaryAction: string;
  hasQr: boolean;
  isDesktop: boolean;
}

export const DOWNLOAD_PLATFORMS: DownloadPlatform[] = [
  {
    id: "web",
    eyebrow: "▸ WEB APP",
    accent: "emerald",
    pitch: "No install. Access tuition portal in any modern browser.",
    primaryAction: "Open web version →",
    hasQr: false,
    isDesktop: false,
  },
  {
    id: "macos",
    eyebrow: "▸ MACOS",
    accent: "cyan",
    pitch: "Universal .dmg desktop installer for Intel + Apple Silicon.",
    primaryAction: "Download .dmg",
    hasQr: false,
    isDesktop: true,
  },
  {
    id: "windows",
    eyebrow: "▸ WINDOWS",
    accent: "cyan",
    pitch: "Per-user .msi installer, runs without admin permissions.",
    primaryAction: "Download .msi",
    hasQr: false,
    isDesktop: true,
  },
  {
    id: "android",
    eyebrow: "▸ ANDROID",
    accent: "emerald",
    pitch: "Play Store application package with automatic updates.",
    primaryAction: "Get on Play Store →",
    hasQr: true,
    isDesktop: false,
  },
];
