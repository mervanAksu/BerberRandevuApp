import { bookedLabels, timeLabel } from '../server/booking.mjs';
import { openBookingDatabase } from './database.mjs';

function todayInIstanbul() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return formatter.format(new Date());
}

async function list(database, date) {
  const rows = await database.prepare(`SELECT reference, service_id, service_ids, service_names, barber_id, barber_name, start_minute,
    end_minute, price, customer_name, customer_phone
    FROM bookings WHERE booking_date = ? AND cancelled_at IS NULL ORDER BY start_minute, barber_id`)
    .bind(date).all();

  if (rows.results.length === 0) {
    console.log(`${date} günü için etkin randevu yok.`);
    return;
  }

  console.log(date);
  console.table(rows.results.map(row => {
    const { barberName, serviceNames } = bookedLabels(row);
    return {
      Kod: row.reference,
      Saat: `${timeLabel(row.start_minute)}–${timeLabel(row.end_minute)}`,
      Berber: barberName,
      Hizmet: serviceNames.join(', '),
      Müşteri: row.customer_name,
      Telefon: row.customer_phone,
      Tutar: `${row.price} ₺`,
    };
  }));
}

async function cancel(database, reference) {
  const result = await database.prepare('UPDATE bookings SET cancelled_at = ? WHERE reference = ? AND cancelled_at IS NULL')
    .bind(Date.now(), reference).run();
  if (result.meta.changes === 0) {
    console.error('Bu kodla etkin randevu bulunamadı.');
    process.exitCode = 1;
  } else {
    console.log(`${reference} numaralı randevu iptal edildi.`);
  }
}

const [command, value, ...extra] = process.argv.slice(2);
const date = value ?? todayInIstanbul();
const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
const validDate = dateValue && Number.isFinite(dateValue.getTime()) && dateValue.toISOString().slice(0, 10) === date;
const reference = value?.toUpperCase();
const validReference = reference && /^MKS-[0-9A-F]{12}$/.test(reference);

if (extra.length || !((command === 'list' && validDate) || (command === 'cancel' && validReference))) {
  console.error('Kullanım\n  npm run bookings -- list [YYYY-AA-GG]\n  npm run bookings -- cancel MKS-XXXXXXXXXXXX');
  process.exitCode = 1;
} else {
  const database = openBookingDatabase();
  try {
    if (command === 'list') await list(database, date);
    else await cancel(database, reference);
  } finally {
    database.close();
  }
}
