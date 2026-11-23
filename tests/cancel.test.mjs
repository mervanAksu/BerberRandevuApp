import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openBookingDatabase } from '../scripts/database.mjs';
import { createApiHandler } from '../server/api.mjs';
import { createBooking } from '../server/booking.mjs';
import { makeCancelPath } from '../server/cancel.mjs';

const origin = 'https://makas.example';
const start = '2026-11-24T07:00:00.000Z'; // 10:00 in Istanbul

function fixture(t) {
  const DB = openBookingDatabase(':memory:');
  t.after(() => DB.close());
  let now = new Date('2026-11-24T06:59:59.000Z');
  const env = { DB, RATE_LIMIT_SECRET: 'synthetic-test-secret' };
  const handle = createApiHandler(() => now);
  const input = {
    serviceIds: ['sac-kesimi', 'yuz-bakimi'], barberId: 'emir', date: '2026-11-24', time: '10:00',
    name: 'Deneme Müşteri', phone: '05550000000', requestId: randomUUID(),
  };
  const makeRequest = (path, options) => handle(new Request(origin + path, options), env);
  const post = (path, body, headers = {}) => makeRequest(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: JSON.stringify(body),
  });
  const slots = () => makeRequest('/api/slots?serviceId=sac-kesimi&barberId=emir&date=2026-11-24');
  return { DB, input, post, makeRequest, slots, now: () => now, at: value => { now = new Date(value); } };
}

function extractToken(cancelPath) {
  assert.match(cancelPath, /^\/iptal\.html#MKS-[A-F0-9]{12}\.[\w-]{43}$/);
  return new URL(cancelPath, origin).hash.slice(1);
}

test('booking and retries return the same private link; preview is read-only and cancellation frees the slot', async t => {
  const shop = fixture(t);
  const response = await shop.post('/api/bookings', shop.input);
  assert.equal(response.status, 201);
  const booking = await response.json();
  const token = extractToken(booking.cancelPath);
  assert.equal(token.includes(shop.input.requestId), false);
  const retry = await shop.post('/api/bookings', shop.input);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).cancelPath, booking.cancelPath);

  const preview = await shop.post('/api/cancel/preview', { token });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await preview.json(), {
    reference: booking.reference, date: '2026-11-24', time: '10:00', barber: 'Emir Kaya',
    services: ['Saç Kesimi', 'Yüz Ağdası'], status: 'active',
  });
  assert.ok(!(await (await shop.slots()).json()).slots.includes('10:00'));

  const confirmations = await Promise.all([
    shop.post('/api/cancel/confirm', { token, confirm: true }),
    shop.post('/api/cancel/confirm', { token, confirm: true }),
  ]);
  for (const confirmation of confirmations) {
    assert.equal(confirmation.status, 200);
    assert.equal((await confirmation.json()).status, 'cancelled');
  }
  assert.ok((await (await shop.slots()).json()).slots.includes('10:00'));

  const cancelledAt = await shop.DB.prepare('SELECT cancelled_at FROM bookings WHERE reference = ?')
    .bind(booking.reference).first('cancelled_at');
  shop.at(start);
  const laterRetry = await shop.post('/api/cancel/confirm', { token, confirm: true });
  assert.equal((await laterRetry.json()).status, 'cancelled');
  assert.equal(await shop.DB.prepare('SELECT cancelled_at FROM bookings WHERE reference = ?')
    .bind(booking.reference).first('cancelled_at'), cancelledAt);
});

test('legacy bookings get valid links and the Istanbul appointment cutoff blocks cancellation', async t => {
  const shop = fixture(t);
  const { confirmation } = await createBooking(shop.DB, shop.input, shop.now());
  const token = extractToken(await makeCancelPath(shop.DB, confirmation.reference));
  shop.at(start);
  const preview = await shop.post('/api/cancel/preview', { token });
  assert.equal((await preview.json()).status, 'past');
  const cancellation = await shop.post('/api/cancel/confirm', { token, confirm: true });
  assert.equal(cancellation.status, 409);
  assert.equal((await cancellation.json()).code, 'BOOKING_STARTED');
  assert.equal(await shop.DB.prepare('SELECT cancelled_at FROM bookings').first('cancelled_at'), null);
});

test('tampered tokens, unsafe origins, and missing confirmation cannot cancel a booking', async t => {
  const shop = fixture(t);
  const { confirmation } = await createBooking(shop.DB, shop.input, shop.now());
  const token = extractToken(await makeCancelPath(shop.DB, confirmation.reference));
  const tampered = token.slice(0, 17) + (token[17] === 'A' ? 'B' : 'A') + token.slice(18);
  for (const badToken of [confirmation.reference, tampered, token + '\n']) {
    const invalid = await shop.post('/api/cancel/preview', { token: badToken });
    assert.equal(invalid.status, 404);
    assert.equal((await invalid.json()).code, 'INVALID_CANCEL_LINK');
  }
  const foreign = await shop.post('/api/cancel/confirm', { token, confirm: true }, { Origin: 'https://foreign.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await shop.post('/api/cancel/confirm', { token })).status, 400);
  assert.equal((await shop.makeRequest('/api/cancel/confirm')).status, 405);
  assert.equal((await shop.post('/api/cancel/preview', { token: 'a'.repeat(520) })).status, 413);
  assert.equal(await shop.DB.prepare('SELECT cancelled_at FROM bookings').first('cancelled_at'), null);
});

test('cancellation links survive database reopen and are specific to an installation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'makas-cancel-'));
  const file = join(directory, 'appointments.sqlite');
  let DB = openBookingDatabase(file);
  t.after(async () => {
    DB.close();
    await rm(directory, { recursive: true, force: true });
  });
  const shop = fixture(t);
  const { confirmation } = await createBooking(DB, shop.input, shop.now());
  const originalPath = await makeCancelPath(DB, confirmation.reference);
  DB.close();
  DB = openBookingDatabase(file);
  assert.equal(await makeCancelPath(DB, confirmation.reference), originalPath);

  await createBooking(shop.DB, shop.input, shop.now());
  await shop.DB.prepare('UPDATE bookings SET reference = ?').bind(confirmation.reference).run();
  assert.notEqual(await makeCancelPath(shop.DB, confirmation.reference), originalPath);
  const rejected = await shop.post('/api/cancel/preview', { token: extractToken(originalPath) });
  assert.equal(rejected.status, 404);
});
