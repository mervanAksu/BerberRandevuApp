import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { openBookingDatabase } from '../scripts/database.mjs';
import { makeCancelPath } from '../server/cancel.mjs';
import { processReminders } from '../server/reminders.mjs';

const start = Date.parse('2026-11-24T09:00:00Z');
const hour = 3_600_000;
const minute = 60_000;
const phone = '+905000000000';
const fakeConfig = {
  SMS_ENABLED: 'true',
  SMS_TURKEY_LOCAL_ENTITY: 'true',
  TWILIO_ACCOUNT_SID: 'AC' + '0'.repeat(32),
  TWILIO_AUTH_TOKEN: '1'.repeat(32),
  TWILIO_SENDER_ID: 'Makas Test',
  APP_ORIGIN: 'https://makas.example',
};

function setup(t) {
  const DB = openBookingDatabase(':memory:');
  t.after(() => DB.close());
  return { DB, ...fakeConfig };
}

async function booking(db, number, {
  date = '2026-11-25', time = 720, createdAt = start - 48 * hour, consent = 1,
  customerPhone = phone, cancelledAt = null, walkIn = 0,
} = {}) {
  const reference = `MKS-${String(number).padStart(12, '0')}`;
  await db.prepare(`
    INSERT INTO bookings (reference, request_id, service_id, barber_id, booking_date, start_minute,
      end_minute, price, customer_name, customer_phone, created_at, sms_consent, cancelled_at, walk_in)
    VALUES (?, ?, 'sac-kesimi', 'emir', ?, ?, ?, 850, 'Test Müşteri', ?, ?, ?, ?, ?)
  `).bind(reference, randomUUID(), date, time, time + 45, customerPhone, createdAt, consent, cancelledAt,
    walkIn).run();
  return reference;
}

function runner(env, fetcher) {
  return (time = start) => processReminders(env, { now: () => time, fetcher });
}

test('sends a Turkish appointment reminder with the private cancellation link 24 hours ahead, once', async t => {
  const env = setup(t);
  const reference = await booking(env.DB, 1);
  const expectedUrl = fakeConfig.APP_ORIGIN + await makeCancelPath(env.DB, reference);
  const calls = [];
  const run = runner(env, (url, options) => {
    calls.push(options.body);
    assert.equal(url, `https://api.twilio.com/2010-04-01/Accounts/${fakeConfig.TWILIO_ACCOUNT_SID}/Messages.json`);
    assert.equal(options.headers.Authorization, 'Basic ' + btoa(`${fakeConfig.TWILIO_ACCOUNT_SID}:${fakeConfig.TWILIO_AUTH_TOKEN}`));
    assert.equal(options.method, 'POST');
    return new Response(null, { status: 201 });
  });

  assert.equal((await run(start - 1)).accepted, 0);
  const results = await Promise.all([run(), run()]);
  assert.equal(results.reduce((sum, result) => sum + result.accepted, 0), 1);
  assert.equal((await run(start + hour)).accepted, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].get('To'), phone);
  assert.equal(calls[0].get('From'), fakeConfig.TWILIO_SENDER_ID);
  assert.equal(calls[0].get('ValidityPeriod'), '1800');
  assert.equal(calls[0].get('Body'), `Makas: 25.11.2026 12:00 randevunuz yaklaşıyor. İptal: ${expectedUrl}`);
});

test('skips opt-outs, fixed lines, past, canceled, imminent and walk-in bookings', async t => {
  const env = setup(t);
  const date = '2026-11-24';
  await booking(env.DB, 2, { date, time: 645 });
  await booking(env.DB, 3, { date, time: 720 });
  await booking(env.DB, 4, { date, time: 780, cancelledAt: start - minute });
  await booking(env.DB, 5, { date, time: 840, consent: 0 });
  await booking(env.DB, 6, { date, time: 900, customerPhone: '+902120000000' });
  await booking(env.DB, 7, { date, time: 960, walkIn: 1, customerPhone: null, consent: 0 });
  const run = runner(env, () => {
    assert.fail('There should be no provider calls');
  });
  assert.deepEqual(await run(), { accepted: 0, retry: 0, failed: 0, uncertain: 0 });
});

test('uses a two-hour lead for a booking made inside 24 hours and omits links by default', async t => {
  const env = setup(t);
  delete env.SMS_TURKEY_LOCAL_ENTITY;
  delete env.APP_ORIGIN;
  await booking(env.DB, 8, { date: '2026-11-24', time: 900, createdAt: start - hour });
  await booking(env.DB, 9, { date: '2026-11-24', time: 765, createdAt: start - minute });
  const bodies = [];
  const run = runner(env, (url, options) => {
    bodies.push(options.body.get('Body'));
    return new Response(null, { status: 201 });
  });
  assert.equal((await run()).accepted, 1);
  assert.match(bodies[0], /24\.11\.2026 12:45/);
  assert.equal((await run(start + hour - 1)).accepted, 0);
  assert.equal((await run(start + hour)).accepted, 1);
  assert.match(bodies[1], /24\.11\.2026 15:00/);
  assert.ok(bodies.every(body => !body.includes('https://')));
});

test('persists exponential retries for 429, ending after three attempts', async t => {
  const env = setup(t);
  const reference = await booking(env.DB, 10);
  let attempts = 0;
  const run = runner(env, () => {
    attempts++;
    return new Response(null, { status: 429 });
  });
  assert.equal((await run()).retry, 1);
  assert.equal((await run(start + 5 * minute - 1)).retry, 0);
  assert.equal((await run(start + 5 * minute)).retry, 1);
  assert.equal((await run(start + 15 * minute - 1)).retry, 0);
  assert.equal((await run(start + 15 * minute)).failed, 1);
  assert.equal((await run(start + hour)).retry, 0);
  assert.equal(attempts, 3);
  assert.equal(await env.DB.prepare('SELECT state FROM sms_reminders WHERE reference = ?')
    .bind(reference).first('state'), 'failed');
});

test('does not re-send uncertain requests or interrupted dispatches', async t => {
  const env = setup(t);
  await booking(env.DB, 11);
  await booking(env.DB, 12, { date: '2026-11-24', time: 780, createdAt: start - hour });
  const stranded = await booking(env.DB, 13, { date: '2026-11-24', time: 840, createdAt: start - hour });
  await env.DB.prepare("INSERT INTO sms_reminders VALUES (?, 'dispatching', 1, NULL, ?)")
    .bind(stranded, start - hour).run();
  let attempts = 0;
  const run = runner(env, () => {
    attempts++;
    if (attempts === 1) throw new Error('network timeout');
    return new Response(null, { status: 503 });
  });
  assert.equal((await run()).uncertain, 2);
  assert.equal((await run(start + hour)).uncertain, 0);
  assert.equal(attempts, 2);
});

test('fails closed with an unsafe cancellation origin and stays off if disabled', async t => {
  const env = setup(t);
  await booking(env.DB, 14);
  env.APP_ORIGIN = 'https://makas.example@elsewhere.example/calendar';
  const run = runner(env, () => assert.fail('There should be no provider calls'));
  await assert.rejects(run(), /APP_ORIGIN/);
  assert.equal(await env.DB.prepare('SELECT count(*) AS count FROM sms_reminders').first('count'), 0);
  env.SMS_ENABLED = 'false';
  assert.deepEqual(await run(), { accepted: 0, retry: 0, failed: 0, uncertain: 0 });
});

test('a cancelled appointment is not sent during its scheduled retry', async t => {
  const env = setup(t);
  const reference = await booking(env.DB, 15);
  let attempts = 0;
  const run = runner(env, () => {
    attempts++;
    return new Response(null, { status: 429 });
  });
  assert.equal((await run()).retry, 1);
  await env.DB.prepare('UPDATE bookings SET cancelled_at = ? WHERE reference = ?')
    .bind(start + minute, reference).run();
  assert.deepEqual(await run(start + 5 * minute), { accepted: 0, retry: 0, failed: 0, uncertain: 0 });
  assert.equal(attempts, 1);
});
