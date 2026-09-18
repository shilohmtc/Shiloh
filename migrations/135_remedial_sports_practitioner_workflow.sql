-- Practitioner-side Remedial / Sports assessment workflow on the live Forms schema.
--
-- Migration 134 created the generic encrypted practitioner-record envelope.
-- This migration adds optimistic revision control and the distinct clinical-manage
-- capability needed by the protected Workspace assessment UI. It does not duplicate
-- or replace the signed client questionnaire.

ALTER TABLE consultation_form_practitioner_records
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

DO $clinical_revision$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid='consultation_form_practitioner_records'::regclass
       AND conname='consultation_form_practitioner_records_revision_check'
  ) THEN
    ALTER TABLE consultation_form_practitioner_records
      ADD CONSTRAINT consultation_form_practitioner_records_revision_check
      CHECK (revision > 0);
  END IF;
END
$clinical_revision$;

-- Clinical editing is deliberately separate from ordinary Forms visibility.
UPDATE staff_admin_accounts
   SET permissions = COALESCE(permissions, '{}'::jsonb) || '{"forms:clinical_manage":true}'::jsonb,
       updated_at = NOW()
 WHERE active=TRUE
   AND business_role IN ('owner','business_admin')
   AND COALESCE((permissions ->> 'forms:clinical_manage')::boolean, FALSE) IS NOT TRUE;

-- Linked practitioners may manage only records for appointments in their existing
-- own-appointment scope. Booking operators / Reception are intentionally excluded.
UPDATE staff_admin_accounts a
   SET permissions = COALESCE(a.permissions, '{}'::jsonb)
       || '{"forms:view":true,"forms:clinical_manage":true}'::jsonb,
       updated_at = NOW()
  FROM staff s
 WHERE a.active=TRUE
   AND a.staff_id=s.id
   AND s.status='active'
   AND a.business_role IN ('employee_practitioner','tenant_practitioner')
   AND a.calendar_scope='own_appointments'
   AND (
     COALESCE((a.permissions ->> 'forms:view')::boolean, FALSE) IS NOT TRUE
     OR COALESCE((a.permissions ->> 'forms:clinical_manage')::boolean, FALSE) IS NOT TRUE
   );
