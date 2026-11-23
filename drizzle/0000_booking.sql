CREATE TABLE bookings (
  reference TEXT NOT NULL PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  service_id TEXT NOT NULL,
  service_ids TEXT CHECK (
    service_ids IS NULL OR (
      json_valid(service_ids) AND json_type(service_ids) = 'array' AND
      json_array_length(service_ids) BETWEEN 2 AND 5 AND json_extract(service_ids, '$[0]') = service_id
    )
  ),
  barber_id TEXT NOT NULL,
  booking_date TEXT NOT NULL CHECK (booking_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute % 15 = 0),
  end_minute INTEGER NOT NULL CHECK (end_minute > start_minute AND end_minute <= 1440 AND end_minute % 15 = 0),
  price INTEGER NOT NULL CHECK (price >= 0),
  customer_name TEXT NOT NULL CHECK (length(customer_name) BETWEEN 2 AND 80),
  customer_phone TEXT NOT NULL CHECK (
    length(customer_phone) = 13 AND substr(customer_phone, 1, 3) = '+90' AND
    substr(customer_phone, 4) NOT GLOB '*[^0-9]*'
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  cancelled_at INTEGER CHECK (cancelled_at >= created_at)
) STRICT;
--> statement-breakpoint
CREATE INDEX bookings_active_intervals ON bookings (barber_id, booking_date, start_minute, end_minute)
WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER bookings_prevent_overlap_insert
BEFORE INSERT ON bookings
WHEN NEW.cancelled_at IS NULL AND EXISTS (
  SELECT 1 FROM bookings
  WHERE barber_id = NEW.barber_id AND booking_date = NEW.booking_date AND cancelled_at IS NULL
    AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
)
BEGIN
  SELECT RAISE(ABORT, 'booking_overlap');
END;
--> statement-breakpoint
CREATE TRIGGER bookings_prevent_overlap_update
BEFORE UPDATE OF barber_id, booking_date, start_minute, end_minute, cancelled_at ON bookings
WHEN NEW.cancelled_at IS NULL AND EXISTS (
  SELECT 1 FROM bookings
  WHERE barber_id = NEW.barber_id AND booking_date = NEW.booking_date AND cancelled_at IS NULL
    AND reference <> OLD.reference AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
)
BEGIN
  SELECT RAISE(ABORT, 'booking_overlap');
END;
--> statement-breakpoint
CREATE TABLE booking_settings (
  name TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE booking_rate_limits (
  fingerprint TEXT NOT NULL PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX booking_rate_limits_window ON booking_rate_limits (window_start);
