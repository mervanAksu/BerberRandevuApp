import { readProfile } from './server/profile.mjs';
import { handleApi } from './server/api.mjs';

const mediaTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:",
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function mediaType(pathname) {
  if (!/^\/(?:[a-z\d_-]+\/)*[a-z\d][a-z\d._-]*\.[a-z\d]+$/i.test(pathname)) return null;
  return mediaTypes[pathname.slice(pathname.lastIndexOf('.')).toLowerCase()] ?? null;
}

export function createBookingApp(readAsset) {
  return async function fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(request, env);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Yöntem desteklenmiyor.', {
        status: 405,
        headers: { ...securityHeaders, Allow: 'GET, HEAD' },
      });
    }

    if (pathname === '/owner.webmanifest') {
      const headers = {
        ...securityHeaders, 'Cache-Control': 'no-cache', 'Content-Type': 'application/manifest+json',
      };
      try {
        const { shop } = await readProfile(env.DB);
        const icons = [192, 512].map(size => ({
          src: `/owner-icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png',
        }));
        if (shop.logoPath && shop.logoPath !== '/mark.svg') icons.unshift({ src: shop.logoPath });
        const manifest = {
          name: `${shop.name} İşletme`, short_name: shop.name, lang: 'tr',
          start_url: '/isletme', scope: '/', display: 'standalone',
          background_color: '#f7f5ee', theme_color: '#182d27', icons,
        };
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(manifest), { headers });
      } catch {
        return new Response(null, { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } });
      }
    }

    const pages = { '/': '/index.html', '/isletme': '/isletme.html', '/isletme/': '/isletme.html' };
    const assetPath = Object.hasOwn(pages, pathname) ? pages[pathname] : pathname;
    const contentType = mediaType(assetPath);
    const bytes = contentType ? await readAsset(assetPath) : null;
    if (!bytes) {
      return new Response(request.method === 'HEAD' ? null : 'Sayfa bulunamadı.', {
        status: 404,
        headers: securityHeaders,
      });
    }

    const cacheable = contentType.startsWith('image/') || contentType.startsWith('font/');
    return new Response(request.method === 'HEAD' ? null : bytes, {
      headers: {
        ...securityHeaders,
        'Content-Type': contentType,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': cacheable ? 'public, max-age=3600' : 'no-cache',
      },
    });
  };
}
