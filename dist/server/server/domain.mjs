export class DomainError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const salonId = id => {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,40}$/.test(id)) {
    throw new DomainError(400, 'INVALID_SALON', 'Geçerli salon seçin.');
  }
  return id;
};

export async function listSalons(db) {
  return (await db.prepare('SELECT id, slug, name, location, theme FROM salons ORDER BY name').all()).results;
}

export async function salonDashboard(db, id) {
  salonId(id);
  const salon = await db.prepare('SELECT id, slug, name, location, theme FROM salons WHERE id = ?').bind(id).first();
  if (!salon) throw new DomainError(404, 'NOT_FOUND', 'Salon bulunamadı.');
  const [services, staff, appointments] = await Promise.all([
    db.prepare('SELECT id, name, duration, price FROM services WHERE salon_id = ? ORDER BY name').bind(id).all(),
    db.prepare('SELECT id, name, role FROM staff WHERE salon_id = ? ORDER BY name').bind(id).all(),
    db.prepare(`SELECT a.id, a.customer_name AS customerName, a.day, a.start_minute AS startMinute,
      a.end_minute AS endMinute, a.status, s.name AS serviceName, t.name AS staffName
      FROM appointments a JOIN services s ON s.id = a.service_id AND s.salon_id = a.salon_id
      JOIN staff t ON t.id = a.staff_id AND t.salon_id = a.salon_id
      WHERE a.salon_id = ? ORDER BY a.day, a.start_minute`).bind(id).all(),
  ]);
  return { salon, services: services.results, staff: staff.results, appointments: appointments.results };
}

export async function createAppointment(db, id, input) {
  salonId(id);
  const { staffId, serviceId, customerName, day, time } = input;
  if (typeof customerName !== 'string' || customerName.trim().length < 2 ||
      customerName.trim().length > 80 || typeof day !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + 'T00:00:00Z')) ||
      typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(time)) {
    throw new DomainError(400, 'INVALID_BOOKING', 'Müşteri, gün ve saati kontrol edin.');
  }
  const service = await db.prepare('SELECT duration FROM services WHERE salon_id = ? AND id = ?')
    .bind(id, serviceId).first();
  const employee = await db.prepare('SELECT 1 FROM staff WHERE salon_id = ? AND id = ?')
    .bind(id, staffId).first();
  if (!service || !employee) throw new DomainError(404, 'WRONG_TENANT', 'Hizmet veya çalışan bu salona ait değil.');
  const start = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  if (start + service.duration > 1440) {
    throw new DomainError(400, 'INVALID_TIME', 'Hizmet günü aşamaz.');
  }
  const appointment = { id: crypto.randomUUID(), salonId: id, staffId, serviceId,
    customerName: customerName.trim(), day, start, end: start + service.duration };
  try {
    await db.prepare(`INSERT INTO appointments
      (id, salon_id, staff_id, service_id, customer_name, day, start_minute, end_minute)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(appointment.id, id, staffId, serviceId, appointment.customerName, day,
      start, appointment.end).run();
  } catch (error) {
    if (/slot_taken/i.test(error.message)) {
      throw new DomainError(409, 'SLOT_TAKEN', 'Bu çalışanın saati dolu.');
    }
    throw error;
  }
  return appointment;
}

const transitions = {
  confirmed: ['arrived', 'completed', 'no_show', 'cancelled'],
  arrived: ['completed', 'cancelled'],
  completed: [],
  no_show: [],
  cancelled: [],
};

export async function updateAppointmentStatus(db, id, appointmentId, status, expectedStatus) {
  salonId(id);
  if (typeof appointmentId !== 'string' || !/^[0-9a-f-]{36}$/.test(appointmentId) ||
      typeof status !== 'string' || !Object.hasOwn(transitions, status) ||
      (expectedStatus !== undefined && (typeof expectedStatus !== 'string' || !Object.hasOwn(transitions, expectedStatus)))) {
    throw new DomainError(400, 'INVALID_STATUS', 'Geçerli randevu ve durum seçin.');
  }
  const find = db.prepare('SELECT status FROM appointments WHERE id = ? AND salon_id = ?').bind(appointmentId, id);
  const existing = await find.first();
  if (!existing) throw new DomainError(404, 'NOT_FOUND', 'Bu salonda randevu bulunamadı.');
  if (status === existing.status) return { ok: true };
  const conflict = () => new DomainError(409, 'STATUS_CONFLICT', 'Randevunun güncel durumu bu işleme uygun değil. Ajandayı yenileyin.');
  if ((expectedStatus !== undefined && expectedStatus !== existing.status) || !transitions[existing.status].includes(status)) {
    throw conflict();
  }
  const changed = await db.prepare('UPDATE appointments SET status = ? WHERE id = ? AND salon_id = ? AND status = ? RETURNING id')
    .bind(status, appointmentId, id, existing.status).first();
  if (!changed && (await find.first())?.status !== status) throw conflict();
  return { ok: true };
}

// A voluntary, demo-only bootstrap with synthetic data; never touches the live Makas DB.
export async function bootstrapDemo(db) {
  const existing = await db.prepare('SELECT COUNT(*) AS n FROM salons').first();
  if (existing.n) return { seeded: false };
  const salons = [
    ['demo-moda', 'makas-moda', 'Makas Moda', 'Kadıköy · İstanbul', 'forest'],
    ['demo-kadikoy', 'ustura-studio', 'Ustura Studio', 'Kadıköy · İstanbul', 'blue'],
    ['demo-besiktas', 'north-barber', 'North Barber', 'Beşiktaş · İstanbul', 'amber'],
  ];
  for (const row of salons) {
    await db.prepare('INSERT INTO salons (id, slug, name, location, theme) VALUES (?, ?, ?, ?, ?)')
      .bind(...row).run();
  }
  const serviceData = [
    ['svc-moda-cut', 'demo-moda', 'Saç kesimi', 45, 650],
    ['svc-moda-beard', 'demo-moda', 'Sakal tıraşı', 30, 400],
    ['svc-kadikoy-cut', 'demo-kadikoy', 'Saç + sakal', 60, 850],
    ['svc-besiktas-cut', 'demo-besiktas', 'Saç kesimi', 45, 750],
  ];
  for (const row of serviceData) await db.prepare(
    'INSERT INTO services (id, salon_id, name, duration, price) VALUES (?, ?, ?, ?, ?)'
  ).bind(...row).run();
  const staffData = [
    ['staff-moda-efe', 'demo-moda', 'Efe', 'Berber'],
    ['staff-moda-ali', 'demo-moda', 'Ali', 'Berber'],
    ['staff-kadikoy-mert', 'demo-kadikoy', 'Mert', 'Kıdemli berber'],
    ['staff-besiktas-can', 'demo-besiktas', 'Can', 'Berber'],
  ];
  for (const row of staffData) await db.prepare(
    'INSERT INTO staff (id, salon_id, name, role) VALUES (?, ?, ?, ?)'
  ).bind(...row).run();
  return { seeded: true };
}
