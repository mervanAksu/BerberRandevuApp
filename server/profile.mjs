import { ApiError, bookingWindow, timeLabel } from './booking.mjs';
import { defaultProfile } from './config.mjs';

function invalid(message) {
  throw new ApiError(400, 'INVALID_PROFILE', message);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function label(value, field, max, required = true) {
  if (typeof value !== 'string') invalid(`${field} alanını kontrol edin.`);
  const text = value.normalize('NFC').trim();
  if ((required && !text) || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) {
    invalid(`${field} alanı en fazla ${max} karakter olmalıdır.`);
  }
  return text;
}

function assetPath(path, logo = false) {
  if (logo && path === '/mark.svg') return path;
  if (typeof path !== 'string' || path.length > 200 ||
      !/^\/media\/(?:[a-z\d_-]+\/)*[a-z\d][a-z\d._-]*\.(?:png|jpe?g|webp|svg)$/i.test(path)) {
    invalid('Salon görselleri için /media/ altındaki bir görselin yolunu girin.');
  }
  return path;
}

function shopDetails(value) {
  if (!record(value) || value.timeZone !== 'Europe/Istanbul' || typeof value.isDemo !== 'boolean') {
    invalid('Salon bilgilerini kontrol edin.');
  }
  return {
    name: label(value.name, 'Salon adı', 80),
    location: label(value.location, 'Konum', 160),
    timeZone: value.timeZone,
    description: label(value.description, 'Salon açıklaması', 600, false),
    logoPath: assetPath(value.logoPath, true),
    imagePath: assetPath(value.imagePath),
    imageAlt: label(value.imageAlt, 'Görsel açıklaması', 160, false),
    isDemo: value.isDemo,
  };
}

function items(rows, max, field) {
  if (!Array.isArray(rows) || rows.length > max) invalid(`${field} listesi en fazla ${max} kayıt içerebilir.`);
  const ids = new Set();
  for (const row of rows) {
    if (!record(row) || typeof row.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.id) ||
        ids.has(row.id) || typeof row.active !== 'boolean') {
      invalid(`${field} listesindeki kayıt kimliğini ve etkinlik durumunu kontrol edin.`);
    }
    ids.add(row.id);
  }
  return ids;
}

function serviceDetails(row) {
  const { id, price, duration, active } = row;
  if (!Number.isInteger(price) || price < 0 || price > 1_000_000) {
    invalid('Hizmet fiyatını 0 ile 1.000.000 arasında tam TL olarak girin.');
  }
  if (!Number.isInteger(duration) || duration < 15 || duration > 1440 || duration % 15 !== 0) {
    invalid('Hizmet süresi 15 dakikanın katı olmalı ve 24 saati aşmamalı.');
  }
  return {
    id, name: label(row.name, 'Hizmet adı', 80), price, duration, active,
    category: label(row.category, 'Hizmet kategorisi', 40, false),
    description: label(row.description, 'Hizmet açıklaması', 300, false),
  };
}

function workingHours(shifts) {
  if (!record(shifts)) invalid('Haftalık çalışma saatlerini kontrol edin.');
  const cleaned = {};
  for (const [day, periods] of Object.entries(shifts)) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(periods) || periods.length > 96) {
      invalid('Haftanın günlerini ve çalışma aralıklarını kontrol edin.');
    }
    let previousEnd = 0;
    cleaned[day] = periods.map(period => {
      if (!Array.isArray(period) || period.length !== 2) invalid('Başlangıç ve bitiş saati girin.');
      const [start, end] = period;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start % 15 || end % 15 ||
          start < previousEnd || start >= end || end > 1440) {
        invalid('Çalışma aralıklarını çakışmadan, 15 dakikalık adımlarla ve saat sırasıyla girin.');
      }
      previousEnd = end;
      return [start, end];
    });
  }
  return cleaned;
}

function normalize(input, previous) {
  const serviceIds = items(input.services, 150, 'Hizmet');
  const barberIds = items(input.barbers, 100, 'Çalışan');
  if (previous.services.some(service => !serviceIds.has(service.id)) ||
      previous.barbers.some(barber => !barberIds.has(barber.id))) {
    invalid('Eski kaydı kaldırmak için hizmeti veya çalışanı pasife alın.');
  }
  return {
    shop: shopDetails(input.shop),
    services: input.services.map(serviceDetails),
    barbers: input.barbers.map(row => {
      if (!Array.isArray(row.serviceIds) || new Set(row.serviceIds).size !== row.serviceIds.length ||
          !row.serviceIds.every(id => serviceIds.has(id))) invalid('Çalışanın yapabildiği hizmetleri kontrol edin.');
      return {
        id: row.id,
        name: label(row.name, 'Çalışan adı', 80),
        title: label(row.title, 'Unvan', 80, false),
        active: row.active,
        serviceIds: row.serviceIds,
        shifts: workingHours(row.shifts),
      };
    }),
  };
}

export async function readProfile(db) {
  const row = await db.prepare('SELECT revision, document FROM salon_profile WHERE id = 1').first();
  if (!row) throw new Error('Salon profili kaydı eksik.');
  return { ...(row.document ? JSON.parse(row.document) : structuredClone(defaultProfile)), revision: row.revision };
}

// Check live bookings and publish the replacement in the same SQL statement. A
// booking accepted after the editor opened must still fit the new schedule.
const conflicts = `
  WITH staff AS (
    SELECT value AS data, json_extract(value, '$.id') AS id FROM json_each(?1, '$.barbers')
  ), enabled_services AS (
    SELECT json_extract(value, '$.id') AS id FROM json_each(?1, '$.services')
    WHERE json_extract(value, '$.active') = 1
  ), conflicts AS (
    SELECT b.booking_date, b.start_minute, b.barber_id FROM bookings AS b
    LEFT JOIN staff ON staff.id = b.barber_id
    WHERE b.cancelled_at IS NULL AND (b.booking_date > ?2 OR (b.booking_date = ?2 AND b.end_minute > ?3))
      AND (json_extract(staff.data, '$.active') IS NOT 1 OR
        NOT EXISTS (
          SELECT 1 FROM json_each(json_extract(staff.data, '$.shifts'), '$."' || strftime('%w', b.booking_date) || '"') AS period
          WHERE json_extract(period.value, '$[0]') <= b.start_minute AND json_extract(period.value, '$[1]') >= b.end_minute
        ) OR EXISTS (
          SELECT 1 FROM json_each(COALESCE(b.service_ids, json_array(b.service_id))) AS booked
          WHERE booked.value NOT IN (SELECT id FROM enabled_services)
             OR booked.value NOT IN (SELECT value FROM json_each(staff.data, '$.serviceIds'))
        )
      )
  )`;

function stale() {
  throw new ApiError(409, 'PROFILE_STALE', 'Salon ayarları başka bir cihazda değişti. Güncel ayarları yükleyip tekrar deneyin.');
}

export async function saveProfile(db, input, now = new Date()) {
  if (!record(input) || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    invalid('Kaydetmeden önce güncel salon ayarlarını yükleyin.');
  }
  const current = await readProfile(db);
  if (current.revision !== input.revision) stale();
  const profile = normalize(input, current);
  const { today, currentMinute } = bookingWindow(now);
  const args = [JSON.stringify(profile), today, currentMinute];
  const result = await db.prepare(`${conflicts}
    UPDATE salon_profile SET document = ?1, revision = revision + 1
    WHERE id = 1 AND revision = ?4 AND NOT EXISTS (SELECT 1 FROM conflicts)
    RETURNING revision`).bind(...args, current.revision).first();
  if (result) return { ...profile, revision: result.revision };
  if ((await readProfile(db)).revision !== current.revision) stale();
  const conflict = await db.prepare(`${conflicts}
    SELECT * FROM conflicts ORDER BY booking_date, start_minute LIMIT 1`).bind(...args).first();
  const barber = current.barbers.find(row => row.id === conflict?.barber_id);
  const detail = conflict ? ` (${barber?.name ?? 'Çalışan'}, ${conflict.booking_date}, ${timeLabel(conflict.start_minute)})` : '';
  throw new ApiError(409, 'PROFILE_BOOKING_CONFLICT',
    `Bu değişiklik mevcut bir randevuyla çakışıyor${detail}. Çalışanın müsaitliğini ve randevudaki hizmetleri koruyun.`);
}
