import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const manifest = {
    version: "1.4.0",
    releasedAt: "2025-06-27T10:00:00Z",
    changelogUrl: "/changelog/1.4.0",
    platforms: {
      macos: {
        url: "https://public.blob.vercel-storage.com/buddysaradhi/desktop/macos/Buddysaradhi-1.4.0-universal.dmg",
        size: 14212456,
        sha256: "a3f5e8b9c1d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
        minOs: "11.0"
      },
      windows: {
        url: "https://public.blob.vercel-storage.com/buddysaradhi/desktop/windows/Buddysaradhi-Setup-1.4.0-x64.msi",
        size: 11800000,
        sha256: "b4f6e9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
        minOs: "10.0.19041"
      },
      android: {
        url: "https://public.blob.vercel-storage.com/buddysaradhi/mobile/android/Buddysaradhi-1.4.0-universal.apk",
        size: 28000000,
        sha256: "c5f7e0d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
        minSdk: "26"
      },
      ios: {
        url: null,
        testFlightUrl: "https://testflight.apple.com/join/abc123XY",
        minIos: "16.0"
      }
    }
  };

  return NextResponse.json(manifest, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
