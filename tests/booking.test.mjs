import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { openBookingDatabase } from '../scripts/database.mjs';
import { createApiHandler } from '../server/api.mjs';
import { readProfile, saveProfile } from '../server/profile.mjs';

const origin = 'https://makas.example';
const tuesday = '2026-11-24';

function bookingFixture(t, instant = '2026-11-23T07:00:00Z') {
  const DB = openBookingDatabase(':memory:');
  t.after(() => DB.close());
  let now = new Date(instant);
  const handle = createApiHandler(() => now);
  const env = { DB, RATE_LIMIT_SECRET: 'synthetic-test-secret' };

  function request(path, options) {
    return handle(new Request(origin + path, options), env);
  }

  function slots({ serviceIds = ['sac-kesimi'], barberId = 'emir', date = tuesday } = {}) {
    const query = new URLSearchParams({ barberId, date });
    for (const id of serviceIds) query.append('serviceId', id);
    return request(`/api/slots?${query}`);
  }

  function post(selection, address = '192.0.2.1') {
    return request('/api/bookings', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': address },
      body: JSON.stringify(selection),
    });
  }

  function selection(changes = {}) {
    return {
      serviceIds: ['sac-kesimi'], barberId: 'emir', date: tuesday, time: '10:00',
      name: 'Deneme Müşteri', phone: '05550000000', requestId: randomUUID(), ...changes,
    };
  }

  return {
    catalog: () => request('/api/catalog'), DB, post, selection, slots,
    at: value => { now = new Date(value); },
  };
}

async function expectCode(response, status, code) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).code, code);
}

async function available(response) {
  assert.equal(response.status, 200);
  const { slots } = await response.json();
  assert.ok(Array.isArray(slots));
  return slots;
}

test('a barber without a shift has no openings and cannot receive a booking', async t => {
  const shop = bookingFixture(t);
  const date = '2026-11-25';
  assert.deepEqual(await available(await shop.slots({ date })), []);
  assert.ok((await available(await shop.slots({ date, barberId: 'kerem' }))).includes('10:00'));
  await expectCode(await shop.post(shop.selection({ date })), 409, 'SLOT_UNAVAILABLE');
});

test('Istanbul midnight changes the date and local time removes elapsed starts', async t => {
  const shop = bookingFixture(t, '2026-11-22T20:59:59Z');
  assert.equal((await (await shop.catalog()).json()).today, '2026-11-22');

  shop.at('2026-11-22T21:00:00Z');
  assert.equal((await (await shop.catalog()).json()).today, '2026-11-23');
  await expectCode(await shop.slots({ date: '2026-11-22' }), 400, 'DATE_OUT_OF_RANGE');
  await expectCode(await shop.post(shop.selection({ date: '2026-11-22' })), 400, 'DATE_OUT_OF_RANGE');

  shop.at('2026-11-23T07:15:00Z');
  const date = '2026-11-23';
  const openings = await available(await shop.slots({ date }));
  assert.equal(openings[0], '10:30');
  for (const time of ['10:00', '10:15']) {
    await expectCode(await shop.post(shop.selection({ date, time })), 409, 'SLOT_UNAVAILABLE');
  }
  assert.equal((await shop.post(shop.selection({ date, time: '10:30' }))).status, 201);
});

test('the 30th future calendar day is included and the 31st is rejected', async t => {
  const shop = bookingFixture(t);
  const barberId = 'deniz';
  const { lastDate } = await (await shop.catalog()).json();
  assert.equal(lastDate, '2026-12-23');
  assert.ok((await available(await shop.slots({ date: lastDate, barberId }))).includes('11:00'));
  assert.equal((await shop.post(shop.selection({ date: lastDate, barberId, time: '11:00' }))).status, 201);

  const date = '2026-12-24';
  await expectCode(await shop.slots({ date, barberId }), 400, 'DATE_OUT_OF_RANGE');
  await expectCode(await shop.post(shop.selection({ date, barberId, time: '11:00' })), 400, 'DATE_OUT_OF_RANGE');
});

test('a service can end at lunch or closing and cannot extend beyond either', async t => {
  const shop = bookingFixture(t);
  const openings = await available(await shop.slots());
  for (const time of ['12:15', '13:45', '17:15']) assert.ok(openings.includes(time), time);
  for (const time of ['12:30', '13:00', '13:30', '17:30']) {
    assert.ok(!openings.includes(time), time);
    await expectCode(await shop.post(shop.selection({ time })), 409, 'SLOT_UNAVAILABLE');
  }
  for (const time of ['12:15', '13:45', '17:15']) {
    assert.equal((await shop.post(shop.selection({ time }))).status, 201, time);
  }
});

test('both endpoints enforce package composition and qualifications for every service', async t => {
  const shop = bookingFixture(t);
  for (const included of ['sac-kesimi', 'sakal-tirasi']) {
    const serviceIds = ['sac-sakal', included];
    await expectCode(await shop.slots({ serviceIds }), 400, 'SERVICE_CONFLICT');
    await expectCode(await shop.post(shop.selection({ serviceIds })), 400, 'SERVICE_CONFLICT');
  }

  const serviceIds = ['sac-kesimi', 'sac-boyama'];
  await expectCode(await shop.slots({ serviceIds }), 400, 'INVALID_BARBER');
  await expectCode(await shop.post(shop.selection({ serviceIds })), 400, 'INVALID_BARBER');
  assert.ok((await available(await shop.slots({ serviceIds, barberId: 'kerem' }))).includes('12:00'));
});

test('the combined duration blocks overlapping starts and preserves both adjacent intervals', async t => {
  const shop = bookingFixture(t);
  const serviceIds = ['yuz-bakimi', 'sac-kesimi'];
  const combinedOpenings = await available(await shop.slots({ serviceIds }));
  assert.ok(combinedOpenings.includes('12:00'));
  assert.ok(!combinedOpenings.includes('12:15'));
  await expectCode(await shop.post(shop.selection({ serviceIds, time: '12:15' })), 409, 'SLOT_UNAVAILABLE');

  const booked = await shop.post(shop.selection({ serviceIds, time: '11:00' }));
  assert.equal(booked.status, 201);
  const row = await shop.DB.prepare('SELECT start_minute, end_minute, price FROM bookings').first();
  assert.equal(row.end_minute - row.start_minute, 60);
  assert.equal(row.price, 1_200);

  const beard = ['sakal-tirasi'];
  const openings = await available(await shop.slots({ serviceIds: beard }));
  for (const time of ['10:45', '11:00', '11:15', '11:30', '11:45']) assert.ok(!openings.includes(time), time);
  await expectCode(await shop.post(shop.selection({ serviceIds: beard, time: '11:45' })), 409, 'SLOT_TAKEN');
  for (const time of ['10:30', '12:00']) {
    assert.ok(openings.includes(time), time);
    assert.equal((await shop.post(shop.selection({ serviceIds: beard, time }))).status, 201, time);
  }
});

test('reusing a request ID with changed booking details leaves the original intact', async t => {
  const shop = bookingFixture(t);
  const selection = shop.selection();
  const original = await shop.post(selection);
  assert.equal(original.status, 201);
  const confirmation = await original.json();
  for (const change of [{ time: '11:00' }, { phone: '05550000001' }, { name: 'Deneme Diğer' }]) {
    await expectCode(await shop.post({ ...selection, ...change }), 409, 'REQUEST_ID_REUSED');
  }

  const replay = await shop.post({ ...selection, phone: '+90 (555) 000 00 00' });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), confirmation);
  assert.ok((await available(await shop.slots())).includes('11:00'));
  assert.equal(await shop.DB.prepare('SELECT COUNT(*) AS count FROM bookings').first('count'), 1);
});

test('either stale quote field prevents creation until the customer accepts the catalog figures', async t => {
  const shop = bookingFixture(t);
  const selection = shop.selection();
  const quotedPrice = 850;
  const quotedDuration = 45;
  await expectCode(await shop.post({ ...selection, quotedPrice: 800 }), 409, 'QUOTE_CHANGED');
  await expectCode(await shop.post({ ...selection, quotedDuration: 30 }), 409, 'QUOTE_CHANGED');
  assert.equal(await shop.DB.prepare('SELECT COUNT(*) AS count FROM bookings').first('count'), 0);
  assert.ok((await available(await shop.slots())).includes(selection.time));

  const accepted = await shop.post({ ...selection, quotedPrice, quotedDuration });
  assert.equal(accepted.status, 201);
  const receipt = await accepted.json();
  assert.equal(receipt.price, quotedPrice);
  assert.equal(receipt.duration, quotedDuration);
});

test('a replay returns the saved price and duration after the catalog changes', async t => {
  const shop = bookingFixture(t);
  const selection = shop.selection();
  const profile = await readProfile(shop.DB);
  const service = profile.services.find(({ id }) => id === 'sac-kesimi');
  const { price, duration } = service;
  const original = await shop.post({ ...selection, profileRevision: profile.revision });
  assert.equal(original.status, 201);
  const receipt = await original.json();
  assert.equal(receipt.price, price);
  assert.equal(receipt.duration, duration);

  service.price += 100;
  service.duration += 15;
  await saveProfile(shop.DB, profile, new Date('2026-11-23T07:00:00Z'));

  const replay = await shop.post({ ...selection, quotedPrice: price, quotedDuration: duration, profileRevision: profile.revision });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), receipt);

  const nextSelection = shop.selection({ time: '11:00' });
  await expectCode(await shop.post({ ...nextSelection, profileRevision: profile.revision }), 409, 'PROFILE_CHANGED');
  const next = await shop.post(nextSelection);
  assert.equal(next.status, 201);
  const updated = await next.json();
  assert.equal(updated.price, service.price);
  assert.equal(updated.duration, service.duration);
});

test('the booking rate window returns a rounded Retry-After and resets at its boundary', async t => {
  const shop = bookingFixture(t, '2026-11-23T07:06:12.300Z');
  const selection = shop.selection();
  assert.equal((await shop.post(selection)).status, 201);
  for (let replay = 0; replay < 11; replay++) assert.equal((await shop.post(selection)).status, 200);

  const limited = await shop.post(selection);
  assert.equal(limited.headers.get('Retry-After'), '228');
  await expectCode(limited, 429, 'RATE_LIMITED');
  assert.equal((await shop.post(shop.selection({ time: '11:00' }), '192.0.2.2')).status, 201);

  shop.at('2026-11-23T07:09:59.900Z');
  const lastSecond = await shop.post(selection);
  assert.equal(lastSecond.headers.get('Retry-After'), '1');
  await expectCode(lastSecond, 429, 'RATE_LIMITED');

  shop.at('2026-11-23T07:10:00Z');
  const reset = await shop.post(selection);
  assert.equal(reset.status, 200);
  assert.equal(reset.headers.get('Retry-After'), null);
});
