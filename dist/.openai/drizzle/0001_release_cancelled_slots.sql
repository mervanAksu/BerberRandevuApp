CREATE TABLE appointments_next (
  id TEXT PRIMARY KEY NOT NULL,
  salon_id TEXT NOT NULL REFERENCES salons(id),
  staff_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  day TEXT NOT NULL,
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','arrived','completed','no_show','cancelled')),
  CHECK(end_minute > start_minute),
  FOREIGN KEY(salon_id, staff_id) REFERENCES staff(salon_id, id),
  FOREIGN KEY(salon_id, service_id) REFERENCES services(salon_id, id)
) STRICT;
--> statement-breakpoint
INSERT INTO appointments_next
  (id, salon_id, staff_id, service_id, customer_name, day, start_minute, end_minute, status)
SELECT id, salon_id, staff_id, service_id, customer_name, day, start_minute, end_minute, status FROM appointments;
--> statement-breakpoint
DROP TABLE appointments;
--> statement-breakpoint
ALTER TABLE appointments_next RENAME TO appointments;
--> statement-breakpoint
CREATE INDEX appointments_tenant_date ON appointments(salon_id, day, staff_id);
--> statement-breakpoint
CREATE INDEX appointments_active_slots ON appointments(salon_id, staff_id, day, start_minute, end_minute)
WHERE status <> 'cancelled';
--> statement-breakpoint
CREATE TRIGGER no_appointment_overlap BEFORE INSERT ON appointments
WHEN NEW.status <> 'cancelled' AND EXISTS (
  SELECT 1 FROM appointments
  WHERE salon_id = NEW.salon_id AND staff_id = NEW.staff_id AND day = NEW.day
    AND status <> 'cancelled'
    AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
)
BEGIN SELECT RAISE(ABORT, 'slot_taken'); END;
--> statement-breakpoint
CREATE TRIGGER no_appointment_overlap_update
BEFORE UPDATE OF salon_id, staff_id, day, start_minute, end_minute, status ON appointments
WHEN NEW.status <> 'cancelled' AND EXISTS (
  SELECT 1 FROM appointments
  WHERE id <> OLD.id AND salon_id = NEW.salon_id AND staff_id = NEW.staff_id AND day = NEW.day
    AND status <> 'cancelled'
    AND start_minute < NEW.end_minute AND end_minute > NEW.start_minute
)
BEGIN SELECT RAISE(ABORT, 'slot_taken'); END;
