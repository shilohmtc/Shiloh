-- SH05: A client may ask Reception to plan a visit without reserving an appointment.
-- Appointment and payment authorities remain in their existing tables.
CREATE TABLE IF NOT EXISTS client_planning_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_key UUID NOT NULL UNIQUE,
  payload_digest TEXT NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients(id),
  source_channel TEXT NOT NULL DEFAULT 'my_shiloh' CHECK (source_channel IN ('my_shiloh')),
  request_kind TEXT NOT NULL CHECK (request_kind IN ('flexible','group')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','planning','declined','arranged')),
  service_id BIGINT REFERENCES services(id),
  service_detail TEXT,
  preferred_date DATE,
  preferred_daypart TEXT CHECK (preferred_daypart IN ('morning','afternoon','any')),
  practitioner_id BIGINT REFERENCES staff(id),
  guest_count INTEGER CHECK (guest_count BETWEEN 2 AND 1000000),
  special_occasion BOOLEAN NOT NULL,
  occasion_note TEXT,
  client_note TEXT,
  linked_appointment_id BIGINT REFERENCES appointments(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  planning_started_at TIMESTAMPTZ,
  planning_by_admin_id BIGINT REFERENCES staff_admin_accounts(id),
  decided_at TIMESTAMPTZ,
  decided_by_admin_id BIGINT REFERENCES staff_admin_accounts(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_planning_requests_detail_check CHECK (
    service_id IS NOT NULL OR NULLIF(BTRIM(service_detail),'') IS NOT NULL
  ),
  CONSTRAINT client_planning_requests_occasion_check CHECK (
    special_occasion=FALSE OR NULLIF(BTRIM(occasion_note),'') IS NOT NULL
  ),
  CONSTRAINT client_planning_requests_group_check CHECK (
    request_kind<>'group' OR guest_count IS NOT NULL
  ),
  CONSTRAINT client_planning_requests_note_bounds CHECK (
    LENGTH(COALESCE(service_detail,''))<=160 AND LENGTH(COALESCE(occasion_note,''))<=160
    AND LENGTH(COALESCE(client_note,''))<=500
  ),
  CONSTRAINT client_planning_requests_state_check CHECK (
    (status='requested' AND planning_started_at IS NULL AND planning_by_admin_id IS NULL AND decided_at IS NULL AND decided_by_admin_id IS NULL AND linked_appointment_id IS NULL)
    OR (status='planning' AND planning_started_at IS NOT NULL AND planning_by_admin_id IS NOT NULL AND decided_at IS NULL AND decided_by_admin_id IS NULL AND linked_appointment_id IS NULL)
    OR (status='declined' AND decided_at IS NOT NULL AND decided_by_admin_id IS NOT NULL AND linked_appointment_id IS NULL)
    OR (status='arranged' AND decided_at IS NOT NULL AND decided_by_admin_id IS NOT NULL AND linked_appointment_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS client_planning_requests_reception_queue
  ON client_planning_requests(requested_at,id) WHERE status IN ('requested','planning');
CREATE INDEX IF NOT EXISTS client_planning_requests_client_history
  ON client_planning_requests(crm_v2_client_id,requested_at DESC,id DESC);
