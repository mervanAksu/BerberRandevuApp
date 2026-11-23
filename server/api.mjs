import { reminderJob } from './jobs.mjs';
import { handleOwner } from './owner.mjs';
import { handleCancel, makeCancelPath } from './cancel.mjs';
import { ApiError, availableSlots, catalog, createBooking } from './booking.mjs';

const maxBodyBytes = 2048;
const rateWindowMs = 10 * 60 * 1000;
const bookingAttempts = 12;
const encode = new TextEncoder();

export function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

export function requireMethod(request, method) {
  if (request.method !== method) {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Bu işlem desteklenmiyor.', { Allow: method });
  }
}

export function checkBookingHeaders(request, url) {
  const origin = request.headers.get('origin');
  if ((origin !== null && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'INVALID_ORIGIN', 'Bu kaynaktan randevu gönderilemez.');
  }

  const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Randevu bilgileri JSON biçiminde olmalı.');
  }

  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBodyBytes)) {
    throw new ApiError(413, 'BODY_TOO_LARGE', 'Randevu isteği çok büyük.');
  }
}

export async function bookingBody(request) {
  if (!request.body) throw new ApiError(400, 'INVALID_JSON', 'Randevu bilgileri okunamadı.');

  const bytes = new Uint8Array(maxBodyBytes);
  const reader = request.body.getReader();
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > bytes.length) {
        void reader.cancel().catch(() => {});
        throw new ApiError(413, 'BODY_TOO_LARGE', 'Randevu isteği çok büyük.');
      }
      bytes.set(value, length);
      length += value.byteLength;
    }

    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ApiError(400, 'INVALID_JSON', 'Randevu bilgileri okunamadı.');
    }
    return input;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', 'Randevu bilgileri okunamadı.');
  } finally {
    reader.releaseLock();
  }
}

async function rateSecret(env) {
  if (typeof env.RATE_LIMIT_SECRET === 'string' && env.RATE_LIMIT_SECRET.length > 0) {
    return env.RATE_LIMIT_SECRET;
  }

  const getSecret = () => env.DB.prepare(`
    SELECT value FROM booking_settings WHERE name = 'rate-limit-secret'
  `).first();
  const existing = await getSecret();
  if (existing) return existing.value;

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const candidate = toHex(bytes);
  const inserted = await env.DB.prepare(`
    INSERT INTO booking_settings (name, value)
    VALUES ('rate-limit-secret', ?)
    ON CONFLICT(name) DO NOTHING
    RETURNING value
  `).bind(candidate).first();
  return (inserted ?? await getSecret()).value;
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function rateLimit(request, env, now) {
  // The Worker receives this header from Cloudflare. The local adapter replaces it with the socket address.
  const incoming = request.headers.get('cf-connecting-ip')?.trim().toLowerCase() ?? '';
  const address = /^[0-9a-f:.]{1,64}$/.test(incoming) ? incoming : 'unknown';
  const key = await crypto.subtle.importKey(
    'raw', encode.encode(await rateSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encode.encode(address));
  const fingerprint = toHex(new Uint8Array(digest));
  const time = now.getTime();
  const windowStart = time - time % rateWindowMs;
  const result = await env.DB.prepare(`
    INSERT INTO booking_rate_limits (fingerprint, window_start, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(fingerprint) DO UPDATE SET
      attempts = CASE WHEN window_start < excluded.window_start THEN 1 ELSE attempts + 1 END,
      window_start = MAX(window_start, excluded.window_start)
    WHERE window_start < excluded.window_start OR attempts < ?
    RETURNING attempts
  `).bind(fingerprint, windowStart, bookingAttempts).first();

  if (!result) {
    const retryAfter = Math.ceil((windowStart + rateWindowMs - time) / 1000);
    throw new ApiError(429, 'RATE_LIMITED', 'Çok fazla istek gönderdin. Biraz bekleyip tekrar dene.', {
      'Retry-After': String(retryAfter),
    });
  }

  await env.DB.prepare(`
    DELETE FROM booking_rate_limits WHERE window_start < ?
  `).bind(windowStart - 5 * rateWindowMs).run();
}

export function createApiHandler(clock = () => new Date()) {
  return async function handleRequest(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/owner/')) return await handleOwner(request, env, clock());
      if (url.pathname.startsWith('/api/cancel/')) return await handleCancel(request, env, clock());
      switch (url.pathname) {
        case '/api/jobs/reminders':
          return await reminderJob(request, env);
        case '/api/catalog':
          requireMethod(request, 'GET');
          return json({ ...catalog(clock()), smsAvailable: env.SMS_ENABLED === 'true' && Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_SENDER_ID) });
        case '/api/slots': {
          requireMethod(request, 'GET');
          const { searchParams } = url;
          const slots = await availableSlots(env.DB, {
            serviceIds: searchParams.getAll('serviceId'),
            barberId: searchParams.get('barberId'),
            date: searchParams.get('date'),
          }, clock());
          return json({ slots });
        }
        case '/api/bookings': {
          requireMethod(request, 'POST');
          checkBookingHeaders(request, url);
          const input = await bookingBody(request);
          await rateLimit(request, env, clock());
          const result = await createBooking(env.DB, input, clock());
          const cancelPath = await makeCancelPath(env.DB, result.confirmation.reference);
          return json({ ...result.confirmation, cancelPath }, result.created ? 201 : 200);
        }
        default:
          throw new ApiError(404, 'NOT_FOUND', 'Bu sayfa bulunamadı.');
      }
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: error.message, code: error.code }, error.status, error.headers);
      }
      return json({
        error: 'Randevu sistemi şu anda kullanılamıyor. Lütfen tekrar dene.',
        code: 'BOOKING_SERVICE_UNAVAILABLE',
      }, 503);
    }
  };
}

export const handleApi = createApiHandler();
