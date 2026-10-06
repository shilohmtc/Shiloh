-- Personal display preferences only. Appointments and their staff history remain
-- canonical and unchanged. An absent preference hides an old declined request.
CREATE TABLE my_shiloh_booking_history_visibility (
  crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients(id) ON DELETE CASCADE,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  hidden BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (crm_v2_client_id, appointment_id)
);

CREATE INDEX idx_my_shiloh_booking_history_visibility_appointment
  ON my_shiloh_booking_history_visibility(appointment_id);
