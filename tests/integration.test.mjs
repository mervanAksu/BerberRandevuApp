import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { startBookingServer } from '../scripts/serve.mjs';

async function temporaryShop(t) {
  const directory = await mkdtemp(join(tmpdir(), 'makas-http-'));
  const databaseFile = join(directory, 'bookings.sqlite');
  let server;
  async function close() {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
  }
  t.after(async () => {
    await close();
    await rm(directory, { recursive: true, force: true });
  });
  async function start() {
    await close();
    server = await startBookingServer({
      host: '127.0.0.1',
      port: 0,
      databaseFile,
      rateLimitSecret: 'isolated-integration-test-secret-only',
    });
    return 'http://127.0.0.1:' + server.address().port;
  }
  return { start, databaseFile };
}

function post(base, payload, headers = {}) {
  return fetch(base + '/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
    body: JSON.stringify(payload),
  });
}

async function chooseAppointment(base, serviceIds) {
  const catalog = await (await fetch(base + '/api/catalog')).json();
  const ids = serviceIds ?? [catalog.barbers[0].serviceIds[0]];
  const barber = catalog.barbers.find(person => ids.every(id => person.serviceIds.includes(id)));
  const day = new Date(catalog.today + 'T12:00:00Z');
  for (let i = 0; i < 7; i++) {
    day.setUTCDate(day.getUTCDate() + 1);
    const date = day.toISOString().slice(0, 10);
    const selection = { barberId: barber.id, date };
    const path = '/api/slots?' + new URLSearchParams(selection);
    const query = new URLSearchParams();
    for (const id of ids) query.append('serviceId', id);
    const slotsPath = path + '&' + query;
    const { slots } = await (await fetch(base + slotsPath)).json();
    if (slots.length) {
      const services = serviceIds ? { serviceIds: ids } : { serviceId: ids[0] };
      return { selection: { ...selection, ...services, time: slots[0] }, path: slotsPath };
    }
  }
  assert.fail('Test kataloğunda yedi gün boyunca müsait çalışan bulunamadı');
}

test('two clients share one calendar and a confirmed reservation survives restart', async t => {
  const shop = await temporaryShop(t);
  let base = await shop.start();
  const { selection, path } = await chooseAppointment(base);
  const payloads = ['Deneme Bir', 'Deneme İki'].map((name, index) => ({
    ...selection,
    requestId: randomUUID(),
    name,
    phone: '0555000000' + index,
  }));
  const results = await Promise.all(payloads.map(payload => post(base, payload)));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const winner = results.findIndex(r => r.status === 201);
  const receipt = await results[winner].json();
  assert.ok(receipt.reference);
  assert.equal(receipt.name, undefined);
  assert.equal(receipt.phone, undefined);

  base = await shop.start();
  const available = await (await fetch(base + path)).json();
  assert.ok(!available.slots.includes(selection.time));
  const replay = await post(base, payloads[winner]);
  assert.equal(replay.ok, true);
  assert.equal((await replay.json()).reference, receipt.reference);
});

test('multiple services reserve the catalog duration and price and replay in any order', async t => {
  const shop = await temporaryShop(t);
  const base = await shop.start();
  const ids = ['yuz-bakimi', 'sac-kesimi'];
  const { selection } = await chooseAppointment(base, ids);
  const catalog = await (await fetch(base + '/api/catalog')).json();
  const services = catalog.services.filter(service => ids.includes(service.id));
  const payload = {
    ...selection,
    name: 'Deneme Müşteri',
    phone: '05550000000',
    requestId: randomUUID(),
    price: 1,
    duration: 1,
  };
  const confirmation = await post(base, payload);
  assert.equal(confirmation.status, 201);
  const receipt = await confirmation.json();
  assert.deepEqual(receipt.serviceIds, services.map(service => service.id));
  const replay = await post(base, { ...payload, serviceIds: [...ids].reverse() });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).reference, receipt.reference);

  const database = new DatabaseSync(shop.databaseFile, { readOnly: true });
  try {
    const rows = database.prepare('SELECT price, end_minute - start_minute AS duration FROM bookings').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].price, services.reduce((sum, service) => sum + service.price, 0));
    assert.equal(rows[0].duration, services.reduce((sum, service) => sum + service.duration, 0));
  } finally {
    database.close();
  }
});

test('the HTTP boundary restricts private data, cross-origin writes and body size', async t => {
  const shop = await temporaryShop(t);
  const base = await shop.start();
  const catalog = await fetch(base + '/api/catalog');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.headers.get('x-content-type-options'), 'nosniff');
  const list = await fetch(base + '/api/bookings');
  assert.ok([404, 405].includes(list.status));
  const privateFile = await fetch(base + '/scripts/serve.mjs');
  assert.equal(privateFile.status, 404);
  const wrongOrigin = await post(base, {}, { Origin: 'https://other.example' });
  assert.equal(wrongOrigin.status, 403);
  const oversized = await post(base, { name: 'a'.repeat(3000) });
  assert.equal(oversized.status, 413);
  const wrongType = await post(base, {}, { 'Content-Type': 'text/plain' });
  assert.equal(wrongType.status, 415);
});
