-- Website publishing and the owner's Morning Welcome Offer. Additive only.
-- No existing appointment, catalogue price, balance, grant or payment is changed.
CREATE TABLE website_content_media (
  id uuid PRIMARY KEY,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 12 AND 2097152),
  created_by bigint REFERENCES staff_admin_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE website_content_posts (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug)<=120),
  kind text NOT NULL CHECK (kind IN ('episode','offer')),
  rule_code text UNIQUE CHECK (rule_code IS NULL OR rule_code='morning_welcome_v1'),
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft)='object'),
  published jsonb CHECK (published IS NULL OR jsonb_typeof(published)='object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  published_at timestamptz,
  updated_by bigint REFERENCES staff_admin_accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='episode' AND rule_code IS NULL) OR (kind='offer' AND rule_code='morning_welcome_v1'))
);
CREATE TABLE website_content_revisions (
  id bigserial PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES website_content_posts(id),
  action text NOT NULL CHECK (action IN ('create','save','publish','unpublish','restore')),
  revision integer NOT NULL,
  document jsonb NOT NULL,
  actor_admin_id bigint REFERENCES staff_admin_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id,revision)
);
CREATE TABLE morning_offer_booking_prices (
  appointment_id bigint PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
  crm_v2_client_id bigint REFERENCES crm_v2_clients(id) ON DELETE SET NULL,
  offer_code text NOT NULL CHECK (offer_code='morning_welcome_v1'),
  canonical_subtotal numeric(12,2) NOT NULL CHECK (canonical_subtotal>0),
  discount_amount numeric(12,2) NOT NULL CHECK (discount_amount>0),
  final_total numeric(12,2) NOT NULL CHECK (final_total>=0),
  terms_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_amount=round(canonical_subtotal*0.20,2)),
  CHECK (final_total=canonical_subtotal-discount_amount)
);
CREATE INDEX morning_offer_client_history ON morning_offer_booking_prices(crm_v2_client_id);
ALTER TABLE admin_booking_sessions ADD COLUMN morning_offer_quote jsonb;
-- A backstop for every rescheduling/payment path, including future callers.
-- Deferred checking permits an atomic move of a whole first-visit group.
CREATE FUNCTION check_morning_offer_booking_price() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id bigint; p morning_offer_booking_prices; a appointments;
BEGIN
  IF TG_TABLE_NAME='appointments' THEN target_id:=NEW.id;
  ELSE target_id:=NEW.appointment_id; END IF;
  SELECT * INTO p FROM morning_offer_booking_prices WHERE appointment_id=target_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO a FROM appointments WHERE id=target_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Snapshot records the original agreement, not a permanent lock on later
  -- authorised no-charge, correction, refund or price-adjustment workflows.
  IF TG_TABLE_NAME='morning_offer_booking_prices' AND
    (a.total_price IS DISTINCT FROM p.final_total OR a.crm_v2_client_id IS DISTINCT FROM p.crm_v2_client_id) THEN
    RAISE EXCEPTION 'Morning Welcome Offer price must match its reviewed booking total' USING ERRCODE='23514';
  END IF;
  IF a.status IN ('scheduled','confirmed','completed','unknown')
    AND a.total_price=p.final_total
    AND COALESCE(to_jsonb(a)->>'financial_classification','standard')='standard' THEN
    IF EXTRACT(ISODOW FROM a.starts_at AT TIME ZONE 'Africa/Johannesburg')=6
      OR (a.starts_at AT TIME ZONE 'Africa/Johannesburg')::time<'08:00'
      OR (a.starts_at AT TIME ZONE 'Africa/Johannesburg')::time>='12:00' THEN
      RAISE EXCEPTION 'Morning Welcome Offer requires a start from 08:00 and before 12:00, excluding Saturdays' USING ERRCODE='P0M01';
    END IF;
    IF EXISTS(SELECT 1 FROM morning_offer_booking_prices other
      JOIN appointments ap ON ap.id=other.appointment_id
      WHERE other.crm_v2_client_id=p.crm_v2_client_id AND ap.status IN ('scheduled','confirmed','completed','unknown')
        AND (ap.starts_at AT TIME ZONE 'Africa/Johannesburg')::date<>(a.starts_at AT TIME ZONE 'Africa/Johannesburg')::date) THEN
      RAISE EXCEPTION 'Morning Welcome Offer applies to one first visit, not separate visit dates' USING ERRCODE='P0M01';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER morning_offer_appointment_price AFTER INSERT OR UPDATE ON appointments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_morning_offer_booking_price();
CREATE CONSTRAINT TRIGGER morning_offer_price_snapshot AFTER INSERT OR UPDATE ON morning_offer_booking_prices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_morning_offer_booking_price();
-- An issued R100 promotional voucher remains usable on an undiscounted booking.
-- Purchased gift vouchers, rewards and treatment credits are payment/credit paths.
CREATE FUNCTION check_morning_offer_welcome_voucher() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='applied' AND EXISTS(
    SELECT 1 FROM booking_payment_accounts bpa
    JOIN appointments a ON a.id=bpa.appointment_id
    JOIN morning_offer_booking_prices p ON p.appointment_id=a.id
    WHERE bpa.id=NEW.booking_payment_account_id AND a.total_price=p.final_total
      AND COALESCE(to_jsonb(a)->>'financial_classification','standard')='standard'
  ) THEN
    RAISE EXCEPTION 'One promotional offer per booking. Choose the Morning Welcome Offer or your promotional voucher.' USING ERRCODE='P0M02';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER morning_offer_welcome_voucher AFTER INSERT OR UPDATE ON booking_welcome_voucher_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_morning_offer_welcome_voucher();
-- The first two pieces are editable drafts. Publishing is an explicit owner action
-- after the pricing integration and controlled release have been verified.
INSERT INTO website_content_posts(id,slug,kind,rule_code,draft) VALUES
('b06a730c-30ec-4245-9f98-2dc8eebbb2d0','no-two-bodies-are-the-same','episode',NULL,
 jsonb_build_object('title','No two bodies are the same. Why should every massage be?',
 'summary','Discover Shiloh · Episode 1. How listening, observation and thoughtful care shape your massage.',
 'body',E'Every body has its own story. Your muscle tension, lifestyle, concerns and treatment goals are individual to you.\n\nWe listen. We take time to understand your discomfort, concerns and what you hope to get from your treatment.\n\nWe observe. We consider muscular tension, movement restrictions and your individual needs.\n\nWe care. We select appropriate massage techniques and tailor your treatment with your comfort and well-being in mind.\n\nAt Shiloh, you are an individual, and you deserve to be treated like one.\n\nComing next: Episode 2 — Your treatment starts before you get onto the massage bed.',
 'episode',1,'imageId',NULL,'imageAlt','','startsAt',NULL,'endsAt',NULL)),
('c674d720-8358-4d16-aeb0-c85a7c0f5a16','morning-welcome-offer','offer','morning_welcome_v1',
 jsonb_build_object('title','Morning Welcome Offer',
 'summary','A thoughtful first visit: save 20% on an eligible morning massage treatment or pedicure.',
 'body','Make a little time for yourself in the morning. Enjoy your first Shiloh experience with a complimentary non-alcoholic welcome drink. Choose an available treatment and morning start time to see your qualifying saving before confirming.',
 'episode',NULL,'imageId',NULL,'imageAlt','','startsAt',NULL,'endsAt',NULL));
INSERT INTO website_content_revisions(post_id,action,revision,document,actor_admin_id)
  SELECT id,'create',revision,draft,NULL FROM website_content_posts;
