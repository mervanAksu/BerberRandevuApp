import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openBookingDatabase } from '../scripts/database.mjs';
import { createApiHandler } from '../server/api.mjs';

const origin = 'https://salon.example';
const settings = '/api/owner/settings';
const monday = '2026-11-23';
const password = 'synthetic-settings-password';

function fixture(t) {
  const DB = openBookingDatabase(':memory:');
  t.after(() => DB.close());
  const handle = createApiHandler(() => new Date('2026-11-22T07:00:00Z'));
  const env = { DB, OWNER_PASSWORD: password };
  let cookie = '';
  function request(path, method = 'GET', body, headers = {}) {
    const options = { method, headers: { cookie, ...headers } };
    if (body !== undefined) {
      options.headers = { origin, 'Content-Type': 'application/json', ...options.headers };
      options.body = JSON.stringify(body);
    }
    return handle(new Request(origin + path, options), env);
  }
  async function login() {
    const response = await request('/api/owner/login', 'POST', { password });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
  }
  return { request, login, DB };
}

async function result(response, status = 200) {
  const resolved = await response;
  const body = await resolved.json();
  assert.equal(resolved.status, status, JSON.stringify(body));
  return body;
}

function appointment(barberId, serviceId, time) {
  return { date: monday, barberId, serviceIds: [serviceId], time, requestId: crypto.randomUUID(),
    name: 'Deneme Müşteri', phone: '05550000000' };
}

test('only the signed-in owner can read and save a coherent salon profile', async t => {
  const { request, login } = fixture(t);
  await result(request(settings), 401);
  await result(request(settings, 'PUT', {}), 401);
  await login();
  const first = await result(request(settings));
  const edited = structuredClone(first);
  edited.profile.shop.name = 'Örnek Salon';
  await result(request(settings, 'PUT', edited, { origin: 'https://other.example' }), 403);
  const invalid = structuredClone(edited);
  invalid.profile.services[0].price = -1;
  await result(request(settings, 'PUT', invalid), 400);
  assert.deepEqual(await result(request(settings)), first);

  const competing = structuredClone(first);
  competing.profile.shop.name = 'İkinci Salon';
  const writes = await Promise.all([edited, competing].map(body => request(settings, 'PUT', body)));
  assert.deepEqual(writes.map(r => r.status).sort(), [200, 409]);
  const winner = await writes.find(r => r.status === 200).json();
  assert.ok(winner.revision > first.revision);
  assert.deepEqual(await result(request(settings)), winner);
  const catalog = await result(request('/api/catalog'));
  assert.equal(catalog.shop.name, winner.profile.shop.name);
});

test('new services and staff use their own shifts, breaks and terms', async t => {
  const { request, login } = fixture(t);
  await login();
  const current = await result(request(settings));
  const service = { ...current.profile.services[0], id: 'test-bakim', name: 'Test Bakım', price: 300, duration: 30 };
  const barber = { ...current.profile.barbers[0], id: 'test-usta', name: 'Test Usta',
    serviceIds: [service.id], shifts: { 1: [[600, 660], [690, 720]] } };
  current.profile.services.push(service);
  current.profile.barbers.push(barber);
  const saved = await result(request(settings, 'PUT', current));
  const catalog = await result(request('/api/catalog'));
  assert.equal(catalog.services.find(item => item.id === service.id).name, service.name);
  assert.equal(catalog.barbers.find(item => item.id === barber.id).name, barber.name);

  const slots = '/api/slots?' + new URLSearchParams({ serviceId: service.id, barberId: barber.id, date: monday });
  assert.deepEqual((await result(request(slots))).slots, ['10:00', '10:15', '10:30', '11:30']);
  const order = appointment(barber.id, service.id, '10:00');
  const receipt = await result(request('/api/bookings', 'POST', order), 201);
  assert.deepEqual((await result(request(slots))).slots, ['10:30', '11:30']);

  const renamed = structuredClone(saved);
  Object.assign(renamed.profile.services.find(item => item.id === service.id), { name: 'Yeni Bakım', price: 600, duration: 15 });
  renamed.profile.barbers.find(item => item.id === barber.id).name = 'Yeni Usta';
  await result(request(settings, 'PUT', renamed));
  const another = appointment(barber.id, service.id, '10:30');
  await result(request('/api/bookings', 'POST', { ...another, profileRevision: saved.revision }), 409);
  await result(request('/api/bookings', 'POST', another), 201);
  const agenda = await result(request('/api/owner/agenda?date=' + monday));
  assert.deepEqual(agenda.bookings.map(item => [item.barberName, item.serviceNames, item.price, item.endTime]), [
    [barber.name, [service.name], 300, '10:30'], ['Yeni Usta', ['Yeni Bakım'], 600, '10:45'],
  ]);
  const preview = await result(request('/api/cancel/preview', 'POST', { token: receipt.cancelPath.split('#')[1] }));
  assert.equal(preview.barber, barber.name);
  assert.deepEqual(preview.services, [service.name]);
  const replay = await result(request('/api/bookings', 'POST', order));
  assert.equal(replay.reference, receipt.reference);
});

test('future appointments protect the assigned staff, service and working hours until cancelled', async t => {
  const { request, login } = fixture(t);
  await login();
  const current = await result(request(settings));
  const order = appointment('emir', 'yuz-bakimi', '10:00');
  const receipt = await result(request('/api/bookings', 'POST', order), 201);
  for (const edit of [
    (barber) => { barber.active = false; },
    (barber, service) => { service.active = false; },
    (barber, service) => { barber.serviceIds = barber.serviceIds.filter(id => id !== service.id); },
    (barber) => { barber.shifts[1] = [[660, 780]]; },
  ]) {
    const edited = structuredClone(current);
    edit(edited.profile.barbers.find(item => item.id === order.barberId),
      edited.profile.services.find(item => item.id === order.serviceIds[0]));
    await result(request(settings, 'PUT', edited), 409);
    assert.deepEqual(await result(request(settings)), current);
  }
  await result(request('/api/owner/cancel', 'POST', { reference: receipt.reference }));
  current.profile.services.find(item => item.id === order.serviceIds[0]).active = false;
  current.profile.barbers.find(item => item.id === order.barberId).active = false;
  await result(request(settings, 'PUT', current));
  const catalog = await result(request('/api/catalog'));
  assert.ok(!catalog.services.some(service => service.id === order.serviceIds[0]));
  assert.ok(!catalog.barbers.some(barber => barber.id === order.barberId));
  assert.ok(catalog.barbers.every(barber => !barber.serviceIds.includes(order.serviceIds[0])));
  const next = appointment(order.barberId, order.serviceIds[0], '10:30');
  await result(request('/api/bookings', 'POST', next), 400);
});

test('legacy appointment labels survive archival of a former employee and service', async t => {
  const { request, login, DB } = fixture(t);
  await login();
  const current = await result(request(settings));
  const barber = current.profile.barbers.find(item => item.id === 'emir');
  const service = current.profile.services.find(item => item.id === 'yuz-bakimi');
  const previousName = barber.name;
  const previousService = service.name;
  const date = '2026-11-16';
  await DB.prepare(`INSERT INTO bookings (
    reference, request_id, service_id, barber_id, booking_date, start_minute, end_minute,
    price, customer_name, walk_in, created_at
  ) VALUES (?, ?, ?, ?, ?, 660, 675, 250, 'Test Müşteri', 1, 1)`)
    .bind('MKS-001122AABBCC', crypto.randomUUID(), service.id, barber.id, date).run();
  Object.assign(barber, { name: 'Başka Usta', active: false });
  Object.assign(service, { name: 'Başka Hizmet', active: false });
  await result(request(settings, 'PUT', current));
  const agenda = await result(request('/api/owner/agenda?date=' + date));
  assert.equal(agenda.bookings[0].barberName, previousName);
  assert.deepEqual(agenda.bookings[0].serviceNames, [previousService]);
  assert.equal(agenda.bookings[0].price, 250);
});
