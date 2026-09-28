-- Bound daily SMS spend without scanning the full historical challenge table.
CREATE INDEX IF NOT EXISTS idx_client_sms_auth_issued_at
  ON client_sms_auth_challenges(issued_at DESC);
