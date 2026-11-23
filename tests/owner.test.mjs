import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiHandler } from '../server/api.mjs';
import { openBookingDatabase } from '../scripts/database.mjs';

const origin = 'https://makas.example';
const date = '2026-11-23';
const password = 'a-synthetic-owner-password';
function fixture(t) {
  const DB = openBookingDatabase(':memory:');
  t.after(() => DB.close());
  const env = { DB, OWNER_PASSWORD: password };
  let instant = new Date('2026-11-23T07:07:00Z');
  const handle = createApiHandler(() => instant);
  let cookie = '';
  function request(path, body, headers = {}) {
    const options = { headers: { cookie, ...headers } };
    if (body !== undefined) {
      options.method = 'POST';
      options.headers = { 'content-type': 'application/json', origin, ...options.headers };
      options.body = JSON.stringify(body);
    }
    return handle(new Request(origin + path, options), env);
  }
  const owner = (path, ...args) => request('/api/owner/' + path, ...args);
  async function login() {
    const response = await owner('login', { password });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  }
  const selection = { barberId: 'emir', date, serviceIds: ['yuz-bakimi'], time: '10:00', requestId: crypto.randomUUID() };
  return { owner, login, request, env, selection, advance: hours => { instant = new Date(+instant + hours * 3600000); } };
}

test('owner requires credentials or verified platform identity, revokes and expires sessions', async t => {
  const app = fixture(t);
  assert.equal((await app.owner('agenda')).status, 401);
  assert.equal((await app.owner('login', { password: 'incorrect' })).status, 401);
  assert.equal((await app.owner('login', { password }, { origin: 'https://other.example' })).status, 403);
  const login = await app.login();
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(login.headers.get('set-cookie').includes(attribute));
  assert.equal((await (await app.owner('agenda')).json()).authMode, 'password');
  assert.equal((await app.owner('logout', {})).status, 200);
  assert.equal((await app.owner('agenda')).status, 401);
  await app.login();
  app.advance(12);
  assert.equal((await app.owner('agenda')).status, 401);
  app.env.OWNER_PASSWORD = '';
  assert.equal((await app.owner('agenda')).status, 503);
  for (const [state, status, code] of [['missing', 401, 'OWNER_SIGN_IN'], ['other', 403, 'OWNER_FORBIDDEN']]) {
    app.env.OWNER_HOSTED_IDENTITY = state;
    const response = await app.owner('agenda');
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
    assert.equal((await app.owner('cancel', { reference: 'test' })).status, status);
  }
  app.env.OWNER_HOSTED_IDENTITY = 'owner';
  assert.equal((await (await app.owner('agenda')).json()).authMode, 'platform');
  assert.equal((await app.owner('blocks', {}, { origin: 'https://other.example' })).status, 403);
});

test('owner login throttles repeated attempts', async t => {
  const app = fixture(t);
  for (let i = 0; i < 12; i++) assert.equal((await app.owner('login', { password: 'wrong' })).status, 401);
  const locked = await app.owner('login', { password });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
});

test('walk-ins can start this quarter, release capacity on cancellation and block bookings in both directions', async t => {
  const app = fixture(t);
  await app.login();
  const walkIn = await app.owner('walk-ins', app.selection);
  assert.equal(walkIn.status, 201);
  const { reference } = await walkIn.json();
  assert.equal((await app.owner('walk-ins', app.selection)).status, 200);
  const first = (await (await app.owner('agenda')).json()).bookings[0];
  assert.equal(first.walkIn, true);
  assert.equal(first.endTime, '10:30');
  assert.equal(first.phone, null);
  const block = { barberId: 'emir', date, time: '10:00', endTime: '10:45', reason: 'Ekip toplantısı' };
  assert.equal((await app.owner('blocks', block)).status, 409);
  assert.equal((await app.owner('cancel', { reference })).status, 200);
  const result = await app.owner('blocks', block);
  assert.equal(result.status, 201);
  const { id } = await result.json();
  assert.equal((await app.owner('blocks', { ...block, time: '10:30', endTime: '11:00' })).status, 409);
  const publicSelection = { ...app.selection, requestId: crypto.randomUUID(), time: '10:30', name: 'Deneme', phone: '05550000000' };
  assert.equal((await app.request('/api/bookings', publicSelection)).status, 409);
  const query = '/api/slots?barberId=emir&date=' + date + '&serviceId=yuz-bakimi';
  const { slots } = await (await app.request(query)).json();
  assert.ok(!slots.includes('10:30') && slots.includes('10:45'));
  assert.equal((await app.request('/api/bookings', { ...publicSelection, time: '10:45' })).status, 201);
  assert.equal((await app.owner('unblock', { id })).status, 200);
  assert.ok((await (await app.request(query)).json()).slots.includes('10:30'));
});

test('rescheduling or restoring a row cannot bypass overlap guards', async t => {
  const app = fixture(t);
  await app.login();
  const walkIn = await app.owner('walk-ins', { ...app.selection, time: '12:00' });
  const { reference } = await walkIn.json();
  const block = await app.owner('blocks', { barberId: 'emir', date, time: '11:00', endTime: '11:30' });
  const { id } = await block.json();
  const db = app.env.DB;
  await assert.rejects(db.prepare('UPDATE staff_blocks SET end_minute = 735 WHERE id = ?').bind(id).run(), /booking_overlap/);
  await assert.rejects(db.prepare('UPDATE bookings SET start_minute = 675 WHERE reference = ?').bind(reference).run(), /booking_overlap/);
  await app.owner('cancel', { reference });
  await db.prepare('UPDATE staff_blocks SET end_minute = 735 WHERE id = ?').bind(id).run();
  await assert.rejects(db.prepare('UPDATE bookings SET cancelled_at = NULL WHERE reference = ?').bind(reference).run(), /booking_overlap/);
});
