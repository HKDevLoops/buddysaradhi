import Link from 'next/link';

type Platform = 'macos' | 'windows' | 'android' | 'ios' | 'linux' | 'web';

export function PlatformDetectChip({ detectedPlatform }: { detectedPlatform: Platform }) {
  let message = '';
  let href = '';
  let colorClass = '';

  switch (detectedPlatform) {
    case 'macos':
      message = "Looks like you're on macOS — download for Mac ↓";
      href = '/download#macos';
      colorClass = 'border-[var(--info)] text-[var(--info)]';
      break;
    case 'windows':
      message = "Looks like you're on Windows — download for Windows ↓";
      href = '/download#windows';
      colorClass = 'border-[var(--info)] text-[var(--info)]';
      break;
    case 'android':
      message = "Looks like you're on Android — get it on Play Store ↓";
      href = '/download#android';
      colorClass = 'border-[var(--success)] text-[var(--success)]';
      break;
    case 'ios':
      message = "Looks like you're on iOS — get it on the App Store ↓";
      href = '/download#ios';
      colorClass = 'border-[var(--success)] text-[var(--success)]';
      break;
    case 'linux':
    case 'web':
    default:
      message = 'Open the web version →';
      href = '/app';
      colorClass = 'border-[var(--success)] text-[var(--success)]';
      break;
  }

  return (
    <div className="flex flex-col items-center mt-6">
      <div className="flex items-center gap-3">
        <Link
          href={href}
          className={`flex items-center justify-center h-[44px] px-4 rounded-full
                     bg-[var(--surface-inset)] border border-opacity-30
                     text-sm font-medium transition-all duration-200 hover:bg-[var(--surface-overlay)]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
                     ${colorClass}`}
          style={{ backdropFilter: "var(--mat-filter)", WebkitBackdropFilter: "var(--mat-filter)" }}
        >
          {message}
        </Link>
        <Link
          href="/download"
          className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          Other platforms ↓
        </Link>
      </div>
    </div>
  );
}
