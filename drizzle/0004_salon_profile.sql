CREATE TABLE salon_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  document TEXT CHECK (document IS NULL OR (json_valid(document) AND json_type(document) = 'object'))
) STRICT;
--> statement-breakpoint
INSERT INTO salon_profile (id, revision, document) VALUES (1, 0, NULL);
--> statement-breakpoint
ALTER TABLE bookings ADD COLUMN barber_name TEXT;
--> statement-breakpoint
ALTER TABLE bookings ADD COLUMN service_names TEXT CHECK (service_names IS NULL OR (json_valid(service_names) AND json_type(service_names) = 'array'));
--> statement-breakpoint
CREATE INDEX bookings_upcoming_profile ON bookings (booking_date, end_minute) WHERE cancelled_at IS NULL;
