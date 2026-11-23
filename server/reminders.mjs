import { timeLabel } from './booking.mjs';
import { makeCancelPath } from './cancel.mjs';
import { readProfile } from './profile.mjs';

const minute = 60_000;
const hour = 60 * minute;
const minimumLead = 15 * minute;
const maximumAttempts = 3;
const batchSize = 25;

function smsConfiguration(env) {
  const { APP_ORIGIN, SMS_TURKEY_LOCAL_ENTITY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SENDER_ID } = env;
  if (!/^AC[a-f\d]{32}$/i.test(TWILIO_ACCOUNT_SID ?? '') ||
      !/^[a-f\d]{32}$/i.test(TWILIO_AUTH_TOKEN ?? '') || !/^(?=.*[a-z])[a-z\d ]{1,11}$/i.test(TWILIO_SENDER_ID ?? '') ||
      TWILIO_SENDER_ID !== TWILIO_SENDER_ID.trim()) {
    throw new Error('SMS yapılandırması veya Türkiye gönderici kaydı eksik.');
  }
  let origin = null;
  if (SMS_TURKEY_LOCAL_ENTITY === 'true') {
    origin = URL.canParse(APP_ORIGIN) ? new URL(APP_ORIGIN) : null;
    if (!origin || origin.protocol !== 'https:' || origin.username || origin.password ||
        origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('SMS için APP_ORIGIN geçerli bir HTTPS kökeni olmalıdır.');
    }
  }
  return {
    url: `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
    sender: TWILIO_SENDER_ID,
    origin: origin?.origin,
  };
}

async function sendMessage(fetcher, config, phone, body, leadMilliseconds, attempts) {
  const message = new URLSearchParams({
    To: phone,
    From: config.sender,
    Body: body,
    ValidityPeriod: String(Math.min(1800, Math.floor(leadMilliseconds / 1000))),
  });

  try {
    const response = await fetcher(config.url, {
      method: 'POST',
      headers: {
        Authorization: config.authorization,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: message,
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    await response.body?.cancel().catch(() => {});
    if (response.ok) return 'accepted';
    if (response.status === 429 && attempts < maximumAttempts) return 'retry';
    if (response.status >= 400 && response.status < 500 && response.status !== 408) return 'failed';
  } catch {
    // A network failure leaves open the possibility that the provider accepted this request.
  }
  return 'uncertain';
}

// Dates and minutes represent shop-local time. Istanbul stays at UTC+03:00 for these appointments.
const appointmentMilliseconds = "(unixepoch(booking_date || 'T00:00:00+03:00') + start_minute * 60) * 1000";

export async function processReminders(env, { now = Date.now, fetcher = fetch } = {}) {
  const counts = { accepted: 0, retry: 0, failed: 0, uncertain: 0 };
  if (env.SMS_ENABLED !== 'true') return counts;
  const config = smsConfiguration(env);
  const db = env.DB;
  const { shop } = await readProfile(db);
  const runAt = now();
  const { results: due } = await db.prepare(`
    WITH upcoming AS (
      SELECT reference, booking_date, start_minute, customer_phone, created_at,
        ${appointmentMilliseconds} AS appointment_at
      FROM bookings
      WHERE sms_consent = 1 AND cancelled_at IS NULL AND customer_phone GLOB '+905?????????'
        AND booking_date BETWEEN date(? / 1000, 'unixepoch', '+3 hours')
          AND date(? / 1000, 'unixepoch', '+3 hours')
    )
    SELECT upcoming.reference, booking_date, start_minute, customer_phone, appointment_at
    FROM upcoming LEFT JOIN sms_reminders AS reminder ON reminder.reference = upcoming.reference
    WHERE appointment_at >= ?
      AND CASE WHEN appointment_at - created_at >= ? THEN appointment_at - ?
        ELSE max(created_at, appointment_at - ?) END <= ?
      AND (reminder.reference IS NULL OR (reminder.state = 'retry' AND reminder.next_attempt_at <= ?))
    ORDER BY appointment_at, upcoming.reference LIMIT ?
  `).bind(runAt, runAt + 24 * hour, runAt + minimumLead, 24 * hour, 24 * hour, 2 * hour,
    runAt, runAt, batchSize).all();

  for (const booking of due) {
    const date = booking.booking_date.split('-').reverse().join('.');
    let body = `${shop.name}: ${date} ${timeLabel(booking.start_minute)} randevunuz yaklaşıyor.`;
    if (config.origin) {
      const path = await makeCancelPath(db, booking.reference);
      if (!path) continue;
      const link = new URL(path, config.origin);
      if (link.origin !== config.origin) throw new Error('SMS iptal bağlantısının kökeni geçersiz.');
      body += ` İptal: ${link.href}`;
    } else {
      body += ' İptal için randevu onayındaki bağlantıyı kullanın.';
    }
    const claimAt = now();
    const claim = await db.prepare(`
      INSERT INTO sms_reminders (reference, state, attempts, updated_at)
      SELECT reference, 'dispatching', 1, ?
      FROM bookings
      WHERE reference = ? AND sms_consent = 1 AND cancelled_at IS NULL
        AND ${appointmentMilliseconds} >= ?
      ON CONFLICT(reference) DO UPDATE SET state = 'dispatching', attempts = attempts + 1,
        updated_at = excluded.updated_at, next_attempt_at = NULL
      WHERE state = 'retry' AND next_attempt_at <= excluded.updated_at AND attempts < ?
      RETURNING attempts
    `).bind(claimAt, booking.reference, claimAt + minimumLead, maximumAttempts).first();
    if (!claim) continue;

    const state = await sendMessage(fetcher, config, booking.customer_phone, body,
      booking.appointment_at - claimAt, claim.attempts);
    const finishedAt = now();
    const nextAttempt = state === 'retry' ? finishedAt + 5 * minute * 2 ** (claim.attempts - 1) : null;
    await db.prepare(`
      UPDATE sms_reminders SET state = ?, next_attempt_at = ?, updated_at = ?
      WHERE reference = ? AND state = 'dispatching'
    `).bind(state, nextAttempt, finishedAt, booking.reference).run();
    counts[state]++;
  }
  return counts;
}
