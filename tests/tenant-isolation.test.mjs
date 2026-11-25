import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { bootstrapDemo, listSalons, salonDashboard, createAppointment,
  updateAppointmentStatus } from '../server/domain.mjs';

const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url))).entries;
function migrate(sqlite, entries) {
  for (const { tag } of entries) {
    const source = readFileSync(new URL('../drizzle/' + tag + '.sql', import.meta.url), 'utf8');
    sqlite.exec('BEGIN');
    try {
      for (const sql of source.split('--> statement-breakpoint')) sqlite.exec(sql);
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
function database(t, entries = journal) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys = ON');
  migrate(sqlite, entries);
  return {
    sqlite,
    prepare(sql) {
      const prepared = sqlite.prepare(sql);
      const wrap = values => ({
        bind: (...next) => wrap(next),
        first: async () => prepared.get(...values) ?? null,
        all: async () => ({ results: prepared.all(...values) }),
        run: async () => prepared.run(...values),
      });
      return wrap([]);
    },
  };
}
test('salons have independent services, staff and appointment queries', async t => {
  const db = database(t);
  assert.deepEqual(await bootstrapDemo(db), { seeded:true });
  assert.deepEqual(await bootstrapDemo(db), { seeded:false });
  assert.equal((await listSalons(db)).length, 3);
  const one = await salonDashboard(db, 'demo-moda');
  const two = await salonDashboard(db, 'demo-kadikoy');
  assert.equal(one.services.length, 2);
  assert.equal(two.services.length, 1);
  assert.equal(one.appointments.length, 0);
});
test('cannot insert cross-salon staff or service, and overlapping slots are blocked', async t => {
  const db = database(t);
  await bootstrapDemo(db);
  const item = { staffId:'staff-moda-efe', serviceId:'svc-moda-cut', customerName:'Demo Müşteri', day:'2026-12-01', time:'10:00' };
  const inserted = await createAppointment(db, 'demo-moda', item);
  assert.ok(inserted.id);
  await assert.rejects(createAppointment(db, 'demo-kadikoy', item), e => e.code === 'WRONG_TENANT');
  await assert.rejects(createAppointment(db, 'demo-moda', {...item,time:'10:15'}), e => e.code === 'SLOT_TAKEN');
  const other = await salonDashboard(db, 'demo-kadikoy');
  assert.equal(other.appointments.length, 0);
  await assert.rejects(updateAppointmentStatus(db, 'demo-kadikoy', inserted.id, 'completed'),
    e => e.code === 'NOT_FOUND');
  await updateAppointmentStatus(db, 'demo-moda', inserted.id, 'completed');
  assert.equal((await salonDashboard(db, 'demo-moda')).appointments[0].status, 'completed');
});

const order = {
  staffId:'staff-moda-efe', serviceId:'svc-moda-cut', customerName:'Örnek Kişi',
  day:'2026-12-03', time:'10:00',
};

test('migration preserves legacy records and releases only the cancelled interval', async t => {
  const db = database(t, journal.slice(0, 1));
  await bootstrapDemo(db);
  const first = await createAppointment(db, 'demo-moda', order);
  const adjacent = await createAppointment(db, 'demo-moda', { ...order, time:'10:45' });
  await updateAppointmentStatus(db, 'demo-moda', first.id, 'cancelled');
  const before = db.sqlite.prepare('SELECT * FROM appointments ORDER BY id').all();
  migrate(db.sqlite, journal.slice(1));
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM appointments ORDER BY id').all(), before);
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);

  const replacement = await createAppointment(db, 'demo-moda', order);
  for (const time of ['09:45', '10:00', '10:30', '10:45']) {
    await assert.rejects(createAppointment(db, 'demo-moda', { ...order, time }), e => e.code === 'SLOT_TAKEN');
  }
  await assert.rejects(updateAppointmentStatus(db, 'demo-moda', first.id, 'arrived'), e => e.code === 'STATUS_CONFLICT');
  const active = (await salonDashboard(db, 'demo-moda')).appointments.filter(a => a.status === 'confirmed');
  assert.deepEqual(new Set(active.map(a => a.id)), new Set([adjacent.id, replacement.id]));
  await createAppointment(db, 'demo-moda', { ...order, staffId:'staff-moda-ali' });
});

test('status changes respect the visible state, idempotent retries and terminal outcomes', async t => {
  const db = database(t);
  await bootstrapDemo(db);
  const first = await createAppointment(db, 'demo-moda', order);
  const change = (status, expected) => updateAppointmentStatus(db, 'demo-moda', first.id, status, expected);
  await change('arrived', 'confirmed');
  await change('arrived', 'confirmed');
  await assert.rejects(change('cancelled', 'confirmed'), e => e.code === 'STATUS_CONFLICT');
  await change('completed', 'arrived');
  await assert.rejects(change('cancelled', 'completed'), e => e.code === 'STATUS_CONFLICT');
  const second = await createAppointment(db, 'demo-moda', { ...order, time:'11:00' });
  await updateAppointmentStatus(db, 'demo-moda', second.id, 'no_show', 'confirmed');
  await assert.rejects(updateAppointmentStatus(db, 'demo-moda', second.id, 'arrived'), e => e.code === 'STATUS_CONFLICT');
  assert.deepEqual((await salonDashboard(db, 'demo-moda')).appointments.map(a => a.status), ['completed','no_show']);
});

test('competing status changes cannot overwrite a newer decision', async t => {
  const db = database(t);
  await bootstrapDemo(db);
  const row = await createAppointment(db, 'demo-moda', order);
  const outcomes = await Promise.allSettled(['arrived','cancelled'].map(status =>
    updateAppointmentStatus(db, 'demo-moda', row.id, status, 'confirmed')));
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(o => o.status === 'rejected').reason.code, 'STATUS_CONFLICT');
});
