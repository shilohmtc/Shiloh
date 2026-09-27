-- SH-05: durable human attention on the verified Shiloh client record.
-- The separate Reception WhatsApp Business app is manual; no external message
-- or read receipt is inferred from this record.
CREATE TABLE IF NOT EXISTS client_human_handoffs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients(id) ON DELETE RESTRICT,
  source_channel TEXT NOT NULL DEFAULT 'my_shiloh' CHECK (source_channel IN ('my_shiloh')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by_admin_id BIGINT REFERENCES staff_admin_accounts(id),
  CONSTRAINT client_human_handoffs_closed_check CHECK (
    (status='open' AND closed_at IS NULL AND closed_by_admin_id IS NULL)
    OR (status='closed' AND closed_at IS NOT NULL AND closed_by_admin_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS client_human_handoffs_one_open_per_client
  ON client_human_handoffs(crm_v2_client_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS client_human_handoffs_reception_queue
  ON client_human_handoffs(requested_at,id) WHERE status='open';
