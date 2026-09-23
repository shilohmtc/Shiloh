-- My Shiloh installed-app push delivery foundation.
-- Push is a delivery channel only. CRM V2 identity and the existing booking,
-- form, payment, voucher and rewards authorities remain canonical.

CREATE TABLE IF NOT EXISTS my_shiloh_push_notifications (
  id BIGSERIAL PRIMARY KEY,
  crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients(id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL UNIQUE CHECK (BTRIM(event_key) <> ''),
  category TEXT NOT NULL CHECK (category IN ('appointment','forms','payment','voucher','rewards','system')),
  title TEXT NOT NULL CHECK (BTRIM(title) <> '' AND CHAR_LENGTH(title) <= 120),
  body TEXT NOT NULL CHECK (BTRIM(body) <> '' AND CHAR_LENGTH(body) <= 240),
  target_path TEXT NOT NULL CHECK (target_path ~ '^/my-shiloh(?:/|$)'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_my_shiloh_push_notifications_client
  ON my_shiloh_push_notifications(crm_v2_client_id, id DESC);

CREATE TABLE IF NOT EXISTS my_shiloh_push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients(id) ON DELETE RESTRICT,
  endpoint TEXT NOT NULL UNIQUE CHECK (endpoint ~ '^https://'),
  p256dh TEXT NOT NULL CHECK (BTRIM(p256dh) <> ''),
  auth TEXT NOT NULL CHECK (BTRIM(auth) <> ''),
  user_agent TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_notification_id BIGINT REFERENCES my_shiloh_push_notifications(id) ON DELETE SET NULL,
  last_push_at TIMESTAMPTZ,
  last_push_status TEXT,
  last_push_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_my_shiloh_push_subscriptions_client_active
  ON my_shiloh_push_subscriptions(crm_v2_client_id, updated_at DESC)
  WHERE enabled=TRUE AND revoked_at IS NULL;

COMMENT ON TABLE my_shiloh_push_subscriptions IS
  'Client-authorized installed-app Web Push endpoints. Delivery only; never client identity authority.';
COMMENT ON TABLE my_shiloh_push_notifications IS
  'Bounded My Shiloh operational notification outbox derived from canonical Shiloh events.';

