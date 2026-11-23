ALTER TABLE bookings RENAME TO bookings_legacy;
--> statement-breakpoint
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
  walk_in INTEGER NOT NULL DEFAULT 0 CHECK (walk_in IN (0, 1)),
  customer_phone TEXT CHECK (
    (customer_phone IS NOT NULL OR walk_in = 1) AND (customer_phone IS NULL OR (
    length(customer_phone) = 13 AND substr(customer_phone, 1, 3) = '+90' AND
    substr(customer_phone, 4) NOT GLOB '*[^0-9]*'))
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  cancelled_at INTEGER CHECK (cancelled_at >= created_at)
) STRICT;
--> statement-breakpoint
INSERT INTO bookings (reference, request_id, service_id, service_ids, barber_id, booking_date, start_minute, end_minute, price, customer_name, customer_phone, created_at, cancelled_at) SELECT reference, request_id, service_id, service_ids, barber_id, booking_date, start_minute, end_minute, price, customer_name, customer_phone, created_at, cancelled_at FROM bookings_legacy;
--> statement-breakpoint
DROP TABLE bookings_legacy;
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
CREATE TABLE owner_sessions (
  digest TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE staff_blocks (
  id TEXT PRIMARY KEY NOT NULL,
  barber_id TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  start_minute INTEGER NOT NULL CHECK(start_minute >= 0 AND start_minute % 15 = 0),
  end_minute INTEGER NOT NULL CHECK(end_minute > start_minute AND end_minute <= 1440 AND end_minute % 15 = 0),
  reason TEXT NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX staff_blocks_intervals ON staff_blocks(barber_id, booking_date, start_minute, end_minute);
--> statement-breakpoint
CREATE TRIGGER bookings_prevent_block_overlap_insert
BEFORE INSERT ON bookings
WHEN NEW.cancelled_at IS NULL AND (EXISTS (
  SELECT 1 FROM staff_blocks WHERE barber_id = NEW.barber_id AND booking_date = NEW.booking_date
    AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
))
BEGIN
  SELECT RAISE(ABORT, 'booking_overlap');
END;
--> statement-breakpoint
CREATE TRIGGER bookings_prevent_block_overlap_update
BEFORE UPDATE ON bookings
WHEN NEW.cancelled_at IS NULL AND (EXISTS (
  SELECT 1 FROM staff_blocks WHERE barber_id = NEW.barber_id AND booking_date = NEW.booking_date
    AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
))
BEGIN
  SELECT RAISE(ABORT, 'booking_overlap');
END;
--> statement-breakpoint
CREATE TRIGGER staff_blocks_prevent_block_overlap_insert
BEFORE INSERT ON staff_blocks
WHEN (EXISTS (
  SELECT 1 FROM bookings WHERE barber_id = NEW.barber_id AND booking_date = NEW.booking_date AND cancelled_at IS NULL
    AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
) OR EXISTS (
  SELECT 1 FROM staff_blocks WHERE barber_id = NEW.barber_id AND booking_date = NEW.booking_date
    AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
))
BEGIN
  SELECT RAISE(ABORT, 'booking_overlap');
END;
--> statement-breakpoint
CREATE TRIGGER staff_blocks_prevent_block_overlap_update
BEFORE UPDATE ON staff_blocks
WHEN (EXISTS (
  SELECT 1 FROM bookings WHERE barber_id = NEW.barber_id AND booking_date = NEW.booking_date AND cancelled_at IS NULL
    AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
) OR EXISTS (
  SELECT 1 FROM staff_blocks WHERE barber_id = NEW.barber_id AND booking_date = NEW.booking_date AND id <> OLD.id
    AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
))
BEGIN
  SELECT RAISE(ABORT, 'booking_overlap');
END;
