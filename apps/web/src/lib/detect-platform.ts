export type Platform = 'macos' | 'windows' | 'android' | 'ios' | 'linux' | 'web';

export function detectPlatform(ua: string): Platform {
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) return 'macos';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return 'web';
}
