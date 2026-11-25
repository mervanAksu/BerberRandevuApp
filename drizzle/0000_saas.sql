CREATE TABLE salons (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'forest'
) STRICT;
--> statement-breakpoint
CREATE TABLE services (
  id TEXT PRIMARY KEY NOT NULL,
  salon_id TEXT NOT NULL REFERENCES salons(id),
  name TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK(duration BETWEEN 15 AND 240),
  price INTEGER NOT NULL CHECK(price >= 0),
  UNIQUE(salon_id, id)
) STRICT;
--> statement-breakpoint
CREATE TABLE staff (
  id TEXT PRIMARY KEY NOT NULL,
  salon_id TEXT NOT NULL REFERENCES salons(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  UNIQUE(salon_id, id)
) STRICT;
--> statement-breakpoint
CREATE TABLE appointments (
  id TEXT PRIMARY KEY NOT NULL,
  salon_id TEXT NOT NULL REFERENCES salons(id),
  staff_id TEXT NOT NULL REFERENCES staff(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  customer_name TEXT NOT NULL,
  day TEXT NOT NULL,
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','arrived','completed','no_show','cancelled')),
  CHECK(end_minute > start_minute),
  UNIQUE(salon_id, staff_id, day, start_minute)
) STRICT;
--> statement-breakpoint
CREATE INDEX appointments_tenant_date ON appointments(salon_id, day, staff_id);
--> statement-breakpoint
CREATE TRIGGER no_appointment_overlap BEFORE INSERT ON appointments
WHEN EXISTS (
  SELECT 1 FROM appointments
  WHERE salon_id = NEW.salon_id AND staff_id = NEW.staff_id AND day = NEW.day
    AND status <> 'cancelled'
    AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
)
BEGIN SELECT RAISE(ABORT, 'slot_taken'); END;
--> statement-breakpoint
CREATE TRIGGER ensure_appointment_tenant BEFORE INSERT ON appointments
WHEN NOT EXISTS (SELECT 1 FROM staff WHERE id=NEW.staff_id AND salon_id=NEW.salon_id)
  OR NOT EXISTS (SELECT 1 FROM services WHERE id=NEW.service_id AND salon_id=NEW.salon_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;
