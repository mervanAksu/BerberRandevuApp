import { ApiError } from './booking.mjs';
import { barbers, services, shop } from './config.mjs';

const encoder = new TextEncoder();
const tokenPattern = /^(MKS-[0-9A-F]{12})\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/;
const maxBodyBytes = 512;
const localTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: shop.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeSignature(signature) {
  return Uint8Array.from(atob(signature.replaceAll('-', '+').replaceAll('_', '/') + '='), char => char.charCodeAt(0));
}

function cancelSecret(db) {
  return db.prepare(`
    SELECT value FROM booking_settings WHERE name = 'customer-cancel-secret'
  `).first('value');
}

async function getOrCreateSecret(db) {
  const existing = await cancelSecret(db);
  if (existing) return existing;
  const candidate = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const inserted = await db.prepare(`
    INSERT INTO booking_settings (name, value)
    VALUES ('customer-cancel-secret', ?)
    ON CONFLICT(name) DO NOTHING
    RETURNING value
  `).bind(candidate).first('value');
  return inserted ?? await cancelSecret(db);
}

async function signingKey(secret, usage) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function signedPayload(reference, requestId) {
  return encoder.encode(`makas/customer-cancel/v1\n${reference}\n${requestId}`);
}

export async function makeCancelPath(db, reference) {
  const requestId = await db.prepare('SELECT request_id FROM bookings WHERE reference = ?').bind(reference)
    .first('request_id');
  if (!requestId) return null;
  const key = await signingKey(await getOrCreateSecret(db), 'sign');
  const signature = await crypto.subtle.sign('HMAC', key, signedPayload(reference, requestId));
  return `/iptal.html#${reference}.${toBase64Url(new Uint8Array(signature))}`;
}

function validateRequest(request, confirm) {
  if (request.method !== 'POST') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Bu işlem desteklenmiyor.', { Allow: 'POST' });
  }
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if ((confirm && origin === null) || (origin !== null && origin !== new URL(request.url).origin) ||
      (site !== null && !['same-origin', 'none'].includes(site))) {
    throw new ApiError(403, 'INVALID_ORIGIN', 'Bu kaynaktan iptal isteği gönderilemez.');
  }
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'İptal isteği JSON biçiminde olmalı.');
  }
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBodyBytes)) {
    throw new ApiError(413, 'BODY_TOO_LARGE', 'İptal isteği çok büyük.');
  }
}

async function readBody(request) {
  if (!request.body) throw new ApiError(400, 'INVALID_JSON', 'İptal isteği okunamadı.');
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxBodyBytes);
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (length + value.byteLength > maxBodyBytes) {
        void reader.cancel().catch(() => {});
        throw new ApiError(413, 'BODY_TOO_LARGE', 'İptal isteği çok büyük.');
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', 'İptal isteği okunamadı.');
  } finally {
    reader.releaseLock();
  }
}

async function bookingForToken(db, token) {
  const match = typeof token === 'string' && token.length === 60 ? tokenPattern.exec(token) : null;
  const invalid = () => new ApiError(404, 'INVALID_CANCEL_LINK', 'Bu iptal bağlantısı geçersiz.');
  if (!match) throw invalid();
  const [, reference, signature] = match;
  const row = await db.prepare(`
    SELECT reference, request_id, service_id, service_ids, barber_id, booking_date, start_minute, cancelled_at
    FROM bookings WHERE reference = ?
  `).bind(reference).first();
  const secret = await cancelSecret(db);
  if (!secret) throw invalid();
  const key = await signingKey(secret, 'verify');
  const valid = await crypto.subtle.verify(
    'HMAC', key, decodeSignature(signature), signedPayload(reference, row?.request_id ?? ''),
  );
  if (!row || !valid) throw invalid();
  return row;
}

function localCutoff(now) {
  const { year, month, day, hour, minute } = Object.fromEntries(
    localTime.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return { date: `${year}-${month}-${day}`, minute: Number(hour) * 60 + Number(minute) };
}

function timeLabel(minute) {
  const hour = String(Math.floor(minute / 60)).padStart(2, '0');
  return `${hour}:${String(minute % 60).padStart(2, '0')}`;
}

function preview(row, cutoff) {
  const future = row.booking_date > cutoff.date ||
    (row.booking_date === cutoff.date && row.start_minute > cutoff.minute);
  const serviceIds = row.service_ids === null ? [row.service_id] : JSON.parse(row.service_ids);
  return {
    reference: row.reference,
    date: row.booking_date,
    time: timeLabel(row.start_minute),
    barber: barbers.find(barber => barber.id === row.barber_id)?.name ?? row.barber_id,
    services: serviceIds.map(id => services.find(service => service.id === id)?.name ?? id),
    status: row.cancelled_at !== null ? 'cancelled' : future ? 'active' : 'past',
  };
}

export async function handleCancel(request, env, now = new Date()) {
  const path = new URL(request.url).pathname;
  const confirm = path === '/api/cancel/confirm';
  if (!confirm && path !== '/api/cancel/preview') {
    throw new ApiError(404, 'NOT_FOUND', 'Bu sayfa bulunamadı.');
  }
  validateRequest(request, confirm);
  const input = await readBody(request);
  if (confirm && input.confirm !== true) {
    throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Randevunu iptal etmek için onay ver.');
  }
  const row = await bookingForToken(env.DB, input.token);
  const cutoff = localCutoff(now);
  let result = preview(row, cutoff);
  if (confirm && result.status === 'active') {
    const cancelled = await env.DB.prepare(`
      UPDATE bookings SET cancelled_at = MAX(created_at, ?)
      WHERE reference = ? AND request_id = ? AND cancelled_at IS NULL
        AND (booking_date > ? OR (booking_date = ? AND start_minute > ?))
      RETURNING cancelled_at
    `).bind(now.getTime(), row.reference, row.request_id, cutoff.date, cutoff.date, cutoff.minute).first();
    if (cancelled) result.status = 'cancelled';
    else result = preview(await bookingForToken(env.DB, input.token), cutoff);
  }
  if (confirm && result.status === 'past') {
    throw new ApiError(409, 'BOOKING_STARTED', 'Başlamış randevular iptal edilemez.');
  }
  return Response.json(result, { headers: {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  } });
}
