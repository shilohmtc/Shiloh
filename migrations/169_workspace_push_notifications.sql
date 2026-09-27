-- Staff-owned Web Push subscriptions; no client data in notification bodies.
CREATE TABLE workspace_push_notifications (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(admin_id,event_key)
);
CREATE INDEX workspace_push_notifications_admin_idx ON workspace_push_notifications(admin_id,id DESC);

CREATE TABLE workspace_push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id) ON DELETE RESTRICT,
  endpoint TEXT NOT NULL UNIQUE CHECK(endpoint ~ '^https://'),
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_notification_id BIGINT NOT NULL DEFAULT 0,
  last_push_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX workspace_push_subscriptions_admin_idx ON workspace_push_subscriptions(admin_id) WHERE enabled=TRUE;
