import { processReminders } from '../server/reminders.mjs';
import { openBookingDatabase } from './database.mjs';

const DB = openBookingDatabase();
try {
  const counts = await processReminders({ ...process.env, DB });
  console.log(JSON.stringify(counts));
} finally {
  DB.close();
}
