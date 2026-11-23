import { ApiError, bookingWindow, createBooking, timeLabel } from './booking.mjs';
import { bookingBody, checkBookingHeaders, json, rateLimit, requireMethod } from './api.mjs';
import { barbers, minutesSinceMidnight } from './config.mjs';

const sessionSeconds = 12 * 60 * 60;
const encode = new TextEncoder();

async function sessionDigest(password, token) {
  const key = await crypto.subtle.importKey('raw', encode.encode(password),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encode.encode(token));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordMatches(expected, input) {
  if (typeof input !== 'string') return false;
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, encode.encode(expected));
  return crypto.subtle.verify('HMAC', key, signature, encode.encode(input));
}

function sessionCookie(url, value, maxAge) {
  return `makas_owner=${value}; Path=/api/owner; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
}

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const day = new Date(date + 'T00:00:00Z');
  return Number.isFinite(day.valueOf()) && day.toISOString().slice(0, 10) === date;
}

async function agenda(db, date, authMode) {
  if (!validDate(date)) throw new ApiError(400, 'INVALID_DATE', 'Geçerli bir tarih seç.');
  const [bookings, blocks] = await Promise.all([
    db.prepare(`SELECT reference, barber_id, start_minute, end_minute, customer_name, customer_phone,
                       service_id, service_ids, walk_in, price FROM bookings WHERE booking_date = ? AND cancelled_at IS NULL
                ORDER BY start_minute, barber_id`).bind(date).all(),
    db.prepare('SELECT * FROM staff_blocks WHERE booking_date = ? ORDER BY start_minute, barber_id').bind(date).all(),
  ]);
  const interval = row => ({ barberId: row.barber_id, date, time: timeLabel(row.start_minute), endTime: timeLabel(row.end_minute) });
  return json({ date, authMode, bookings: bookings.results.map(row => ({
    ...interval(row), reference: row.reference, name: row.customer_name, phone: row.customer_phone,
    serviceIds: row.service_ids ? JSON.parse(row.service_ids) : [row.service_id],
    walkIn: Boolean(row.walk_in), price: row.price,
  })), blocks: blocks.results.map(row => ({ ...interval(row), id: row.id, reason: row.reason })) });
}

async function block(db, input, now) {
  const { barberId, date, time, endTime, reason = '' } = input;
  const window = bookingWindow(now);
  const quarter = /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/;
  if (!barbers.some(barber => barber.id === barberId) || !validDate(date) || date < window.today ||
      date > window.lastDate || typeof time !== 'string' || typeof endTime !== 'string' || !quarter.test(time) || !quarter.test(endTime) || time >= endTime ||
      typeof reason !== 'string' || reason.length > 120 ||
      (date === window.today && minutesSinceMidnight(endTime) <= window.currentMinute)) {
    throw new ApiError(400, 'INVALID_BLOCK', 'Çalışanı, tarihi ve saat aralığını kontrol et.');
  }
  const id = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO staff_blocks (id, barber_id, booking_date, start_minute, end_minute, reason)
                      VALUES (?, ?, ?, ?, ?, ?)`).bind(id, barberId, date, minutesSinceMidnight(time),
      minutesSinceMidnight(endTime), reason.trim()).run();
  } catch (error) {
    if (error.message?.includes('booking_overlap')) throw new ApiError(409, 'SLOT_TAKEN', 'Bu aralıkta randevu veya kapalı saat var.');
    throw error;
  }
  return json({ id }, 201);
}

export async function handleOwner(request, env, now = new Date()) {
  const password = env.OWNER_PASSWORD;
  const platform = env.OWNER_VERIFIED_BY_PLATFORM === true;
  if (!platform && (typeof password !== 'string' || password.trim().length < 16)) {
    throw new ApiError(503, 'OWNER_UNCONFIGURED', 'İşletme girişi henüz yapılandırılmadı.');
  }
  const url = new URL(request.url);
  const action = url.pathname.slice('/api/owner/'.length);
  requireMethod(request, action === 'agenda' ? 'GET' : 'POST');
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) {
      throw new ApiError(403, 'INVALID_ORIGIN', 'Bu kaynaktan işletme işlemi yapılamaz.');
    }
    checkBookingHeaders(request, url);
  }
  const db = env.DB;
  if (platform && action === 'login') return json({ ok: true });
  if (action === 'login') {
    await rateLimit(request, { DB: db, RATE_LIMIT_SECRET: 'owner-login:' + password }, now);
    const input = await bookingBody(request);
    if (!await passwordMatches(password, input.password)) throw new ApiError(401, 'INVALID_PASSWORD', 'İşletme parolası yanlış.');
    const token = crypto.randomUUID() + crypto.randomUUID();
    const digest = await sessionDigest(password, token);
    await db.prepare('DELETE FROM owner_sessions WHERE expires_at <= ?').bind(now.getTime()).run();
    await db.prepare('INSERT INTO owner_sessions (digest, expires_at) VALUES (?, ?)')
      .bind(digest, now.getTime() + sessionSeconds * 1000).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(url, token, sessionSeconds) });
  }
  const token = /(?:^|;\s*)makas_owner=([a-f0-9-]{72})(?:;|$)/.exec(request.headers.get('cookie') ?? '')?.[1];
  const digest = !platform && token && await sessionDigest(password, token);
  if (!platform && (!digest || !await db.prepare('SELECT 1 FROM owner_sessions WHERE digest = ? AND expires_at > ?')
    .bind(digest, now.getTime()).first())) throw new ApiError(401, 'LOGIN_REQUIRED', 'İşletme parolanla giriş yap.');
  if (action === 'agenda') return agenda(db, url.searchParams.get('date') || bookingWindow(now).today, platform ? 'platform' : 'password');
  const input = await bookingBody(request);
  switch (action) {
    case 'logout':
      if (digest) await db.prepare('DELETE FROM owner_sessions WHERE digest = ?').bind(digest).run();
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(url, '', 0) });
    case 'walk-ins': {
      const result = await createBooking(db, input, now, { walkIn: true });
      return json(result.confirmation, result.created ? 201 : 200);
    }
    case 'blocks':
      return block(db, input, now);
    case 'unblock':
      if (typeof input.id !== 'string') throw new ApiError(400, 'INVALID_BLOCK', 'Kapalı saati seç.');
      await db.prepare('DELETE FROM staff_blocks WHERE id = ?').bind(input.id).run();
      return json({ ok: true });
    case 'cancel': {
      if (typeof input.reference !== 'string') throw new ApiError(400, 'INVALID_REFERENCE', 'Randevuyu seç.');
      const row = await db.prepare(`UPDATE bookings SET cancelled_at = COALESCE(cancelled_at, MAX(created_at, ?))
        WHERE reference = ? RETURNING reference`).bind(now.getTime(), input.reference).first();
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Randevu bulunamadı.');
      return json({ ok: true });
    }
    default:
      throw new ApiError(404, 'NOT_FOUND', 'Bu sayfa bulunamadı.');
  }
}
