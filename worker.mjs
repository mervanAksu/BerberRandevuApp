import { bootstrapDemo, createAppointment, DomainError, listSalons,
  salonDashboard, updateAppointmentStatus } from './server/domain.mjs';

const page = '__INJECT_HTML__';
const script = '__INJECT_SCRIPT__';
const security = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const reply = (body, status = 200) => Response.json(body, { status, headers: security });

async function jsonBody(request) {
  const origin = request.headers.get('Origin');
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new DomainError(403, 'ORIGIN', 'Bu kaynaktan işlem yapılamaz.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new DomainError(415, 'TYPE', 'JSON gönderin.');
  }
  if (Number(request.headers.get('content-length') || 0) > 2048) {
    throw new DomainError(413, 'BODY_TOO_LARGE', 'İstek çok büyük.');
  }
  const raw = await request.text();
  if (raw.length > 2048) throw new DomainError(413, 'BODY_TOO_LARGE', 'İstek çok büyük.');
  try {
    const body = JSON.parse(raw);
    if (!body || Array.isArray(body) || typeof body !== 'object') throw Error();
    return body;
  } catch { throw new DomainError(400, 'INVALID_JSON', 'Geçersiz veri.'); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(page, { headers: { ...security, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/app.js' && request.method === 'GET') {
      return new Response(script, { headers: { ...security, 'Content-Type': 'text/javascript; charset=utf-8' } });
    }
    if (!url.pathname.startsWith('/api/')) return new Response('Bulunamadı', { status: 404, headers: security });
    if (!env.DB) return reply({ error: 'Demo veritabanı hazır değil.' }, 503);
    try {
      if (url.pathname === '/api/salons' && request.method === 'GET') {
        return reply({ salons: await listSalons(env.DB) });
      }
      if (url.pathname === '/api/bootstrap' && request.method === 'POST') {
        await jsonBody(request);
        return reply(await bootstrapDemo(env.DB));
      }
      const match = /^\/api\/salons\/([a-z][a-z0-9-]{1,40})(?:\/(appointments|status))?$/.exec(url.pathname);
      if (!match) return reply({ error: 'API bulunamadı.' }, 404);
      const [, id, action] = match;
      if (!action && request.method === 'GET') return reply(await salonDashboard(env.DB, id));
      if (action === 'appointments' && request.method === 'POST') {
        return reply(await createAppointment(env.DB, id, await jsonBody(request)), 201);
      }
      if (action === 'status' && request.method === 'POST') {
        const { appointmentId, status, expectedStatus } = await jsonBody(request);
        return reply(await updateAppointmentStatus(env.DB, id, appointmentId, status, expectedStatus));
      }
      return reply({ error: 'Yöntem desteklenmiyor.' }, 405);
    } catch (error) {
      if (error instanceof DomainError) return reply({ error: error.message, code: error.code }, error.status);
      return reply({ error: 'İşlem tamamlanamadı.' }, 503);
    }
  },
};
