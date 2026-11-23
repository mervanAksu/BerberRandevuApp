ALTER TABLE bookings ADD COLUMN sms_consent INTEGER NOT NULL DEFAULT 0 CHECK (sms_consent IN (0, 1));
--> statement-breakpoint
CREATE INDEX bookings_sms_active ON bookings (booking_date, start_minute)
WHERE sms_consent = 1 AND cancelled_at IS NULL;
--> statement-breakpoint
CREATE TABLE sms_reminders (
  reference TEXT NOT NULL PRIMARY KEY REFERENCES bookings (reference) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('dispatching', 'accepted', 'retry', 'failed', 'uncertain')),
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 3),
  next_attempt_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;
