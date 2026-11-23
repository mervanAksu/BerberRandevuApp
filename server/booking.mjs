import { barbers, minutesSinceMidnight, services, shop } from './config.mjs';

const slotStep = 15;
const bookingDays = 30;
const dayMilliseconds = 86_400_000;
const localTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: shop.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export class ApiError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function bookingWindow(now) {
  const { year, month, day, hour, minute } = Object.fromEntries(
    localTime.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  const today = `${year}-${month}-${day}`;
  const todayStart = Date.parse(`${today}T00:00:00Z`);
  const lastDate = new Date(todayStart + bookingDays * dayMilliseconds).toISOString().slice(0, 10);
  return { today, lastDate, currentMinute: Number(hour) * 60 + Number(minute) };
}

export function catalog(now) {
  const { today, lastDate } = bookingWindow(now);
  return {
    shop,
    services,
    barbers: barbers.map(({ id, name, title, serviceIds }) => ({ id, name, title, serviceIds })),
    today,
    lastDate,
  };
}

function appointmentDetails(selectedIds, barberId, date) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0 || selectedIds.length > services.length ||
      new Set(selectedIds).size !== selectedIds.length) {
    throw new ApiError(400, 'INVALID_SERVICE', 'Geçerli hizmetler seç.');
  }

  const selection = services.filter(({ id }) => selectedIds.includes(id));
  if (selection.length !== selectedIds.length) {
    throw new ApiError(400, 'INVALID_SERVICE', 'Geçerli hizmetler seç.');
  }
  if (selectedIds.includes('sac-sakal') &&
      (selectedIds.includes('sac-kesimi') || selectedIds.includes('sakal-tirasi'))) {
    throw new ApiError(400, 'SERVICE_CONFLICT', 'Saç & Sakal paketi zaten bu hizmeti içeriyor.');
  }

  const barber = barbers.find(({ id }) => id === barberId);
  if (!barber || !selectedIds.every((id) => barber.serviceIds.includes(id))) {
    throw new ApiError(400, 'INVALID_BARBER', 'Seçtiğin hizmetlere uygun bir berber seç.');
  }

  const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00Z`)
    : new Date(NaN);
  if (Number.isNaN(day.valueOf()) || day.toISOString().slice(0, 10) !== date) {
    throw new ApiError(400, 'INVALID_DATE', 'Geçerli bir tarih seç.');
  }

  const serviceIds = selection.map(({ id }) => id);
  const duration = selection.reduce((total, service) => total + service.duration, 0);
  const price = selection.reduce((total, service) => total + service.price, 0);
  return { serviceIds, duration, price, barberId, date, shifts: barber.shifts[day.getUTCDay()] ?? [] };
}

function checkDateRange(date, window) {
  if (date < window.today || date > window.lastDate) {
    throw new ApiError(400, 'DATE_OUT_OF_RANGE', 'Önümüzdeki 30 gün içinde bir tarih seç.');
  }
}

function timeLabel(minute) {
  const hourLabel = String(Math.floor(minute / 60)).padStart(2, '0');
  const minuteLabel = String(minute % 60).padStart(2, '0');
  return `${hourLabel}:${minuteLabel}`;
}

function isUpcoming(date, minute, window) {
  return date !== window.today || minute > window.currentMinute;
}

export async function availableSlots(db, { serviceIds, barberId, date }, now) {
  const { duration, shifts } = appointmentDetails(serviceIds, barberId, date);
  const window = bookingWindow(now);
  checkDateRange(date, window);

  if (shifts.length === 0) return [];

  const { results: appointments } = await db.prepare(`
    SELECT start_minute, end_minute
    FROM bookings
    WHERE barber_id = ? AND booking_date = ? AND cancelled_at IS NULL
    ORDER BY start_minute
  `).bind(barberId, date).all();

  const slots = [];
  for (const [open, close] of shifts) {
    for (let minute = open; minute + duration <= close; minute += slotStep) {
      const overlaps = appointments.some(({ start_minute, end_minute }) =>
        minute < end_minute && start_minute < minute + duration,
      );
      if (!overlaps && isUpcoming(date, minute, window)) slots.push(timeLabel(minute));
    }
  }
  return slots;
}

function customerName(value) {
  const name = typeof value === 'string' ? value.normalize('NFC').trim().replace(/\p{Zs}+/gu, ' ') : '';
  const namePart = /^\p{L}[\p{L}\p{M}]*(?:['’‐‑-]\p{L}[\p{L}\p{M}]*)*\.?$/u;
  if ([...name].length > 80 || (name.match(/\p{L}/gu)?.length ?? 0) < 2 ||
      !name.split(' ').every((part) => namePart.test(part))) {
    throw new ApiError(400, 'INVALID_NAME', 'Adını ve soyadını gir.');
  }
  return name;
}

function customerPhone(value) {
  const phone = typeof value === 'string' ? value.trim() : '';
  const compact = phone.replace(/[().\p{Zs}-]/gu, '');
  const domesticNumber = /^(?:(?:\+|00)?90|0)?([2-5]\d{9}|850\d{7})$/.exec(compact)?.[1];
  if (phone.length > 64 || !domesticNumber) {
    throw new ApiError(400, 'INVALID_PHONE', 'Geçerli bir Türkiye telefon numarası gir.');
  }
  return `+90${domesticNumber}`;
}

function bookingInput(input) {
  const { serviceId, serviceIds, barberId, date, time } = input;
  if (Object.hasOwn(input, 'serviceId') && Object.hasOwn(input, 'serviceIds')) {
    throw new ApiError(400, 'INVALID_SERVICE', 'Hizmet seçimini yeniden gönder.');
  }
  const details = appointmentDetails(Object.hasOwn(input, 'serviceIds') ? serviceIds : [serviceId], barberId, date);
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(time)) {
    throw new ApiError(400, 'INVALID_TIME', 'Geçerli bir saat seç.');
  }

  const requestId = typeof input.requestId === 'string' ? input.requestId.toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    throw new ApiError(400, 'INVALID_REQUEST_ID', 'Randevu isteğini yenileyip tekrar dene.');
  }

  const start = minutesSinceMidnight(time);
  return {
    ...details,
    time,
    start,
    end: start + details.duration,
    name: customerName(input.name),
    phone: customerPhone(input.phone),
    requestId,
  };
}

function confirmation({ reference, price, duration }, booking) {
  return {
    reference,
    price,
    duration,
    serviceIds: booking.serviceIds,
    ...(booking.serviceIds.length === 1 ? { serviceId: booking.serviceIds[0] } : {}),
    barberId: booking.barberId,
    date: booking.date,
    time: booking.time,
  };
}

async function previousBooking(db, booking) {
  const existing = await db.prepare(`
    SELECT reference, price, end_minute - start_minute AS duration,
           service_id, service_ids, barber_id, booking_date, start_minute,
           customer_name, customer_phone, cancelled_at
    FROM bookings
    WHERE request_id = ?
  `).bind(booking.requestId).first();

  if (!existing) return null;
  const previousServices = existing.service_ids ?? JSON.stringify([existing.service_id]);
  if (previousServices !== JSON.stringify(booking.serviceIds) || existing.barber_id !== booking.barberId ||
      existing.booking_date !== booking.date || existing.start_minute !== booking.start ||
      existing.customer_name !== booking.name || existing.customer_phone !== booking.phone) {
    throw new ApiError(409, 'REQUEST_ID_REUSED', 'Randevu bilgileri değişti. Seçimini yeniden gönder.');
  }
  if (existing.cancelled_at !== null) {
    throw new ApiError(409, 'BOOKING_CANCELLED', 'Bu randevu iptal edildi. Yeni bir saat seç.');
  }
  return confirmation(existing, booking);
}

export async function createBooking(db, input, now) {
  const booking = bookingInput(input);
  const existing = await previousBooking(db, booking);
  if (existing) return { confirmation: existing, created: false };

  const { quotedPrice, quotedDuration } = input;
  if ((quotedPrice !== undefined && quotedPrice !== booking.price) ||
      (quotedDuration !== undefined && quotedDuration !== booking.duration)) {
    throw new ApiError(409, 'QUOTE_CHANGED', 'Hizmet fiyatı veya süresi değişti. Güncel bilgileri kontrol edip tekrar dene.');
  }

  const window = bookingWindow(now);
  checkDateRange(booking.date, window);
  const fitsShift = booking.shifts.some(([open, close]) => booking.start >= open && booking.end <= close);
  if (!fitsShift || !isUpcoming(booking.date, booking.start, window)) {
    throw new ApiError(409, 'SLOT_UNAVAILABLE', 'Bu saat uygun değil. Başka bir saat seç.');
  }

  const reference = `MKS-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const serviceList = booking.serviceIds.length > 1 ? JSON.stringify(booking.serviceIds) : null;
  let inserted;
  try {
    inserted = await db.prepare(`
      INSERT INTO bookings (
        reference, request_id, service_id, service_ids, barber_id, booking_date, start_minute,
        end_minute, price, customer_name, customer_phone, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE request_id = ?)
      RETURNING reference, price, end_minute - start_minute AS duration
    `).bind(
      reference, booking.requestId, booking.serviceIds[0], serviceList, booking.barberId, booking.date,
      booking.start, booking.end, booking.price, booking.name, booking.phone,
      now.getTime(), booking.requestId,
    ).first();
  } catch (error) {
    if (error instanceof Error && error.message.includes('booking_overlap')) {
      throw new ApiError(409, 'SLOT_TAKEN', 'Bu saat az önce doldu. Başka bir saat seç.');
    }
    throw error;
  }

  if (inserted) return { confirmation: confirmation(inserted, booking), created: true };

  const retried = await previousBooking(db, booking);
  if (!retried) throw new Error('Booking disappeared during retry');
  return { confirmation: retried, created: false };
}
