import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/_next/',
        '/dashboard',
        '/students',
        '/attendance',
        '/fees',
        '/settings',
        '/signup',
        '/login',
        '/verify',
      ],
    },
    sitemap: 'https://buddysaradhi.app/sitemap.xml',
    host: 'https://buddysaradhi.app',
  };
}
