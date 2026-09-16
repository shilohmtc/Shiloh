-- Remedial / Sports Massage consultation and practitioner assessment.
--
-- The client-facing form reuses the shared Core Massage Consultation and adds only
-- the genuinely sports/remedial-specific intake from the uploaded paper form.
-- Practitioner assessment data (posture, body map, techniques and notes) is stored
-- separately from the signed client questionnaire and is application-encrypted.

INSERT INTO consultation_form_sections(section_key, title)
VALUES ('remedial_sports_massage_screening', 'Remedial & Sports Massage Screening')
ON CONFLICT (section_key) DO NOTHING;

INSERT INTO consultation_form_section_versions(section_id, version_number, definition, source_label)
SELECT s.id, 1, $json$
{
  "schema_version": 1,
  "groups": [
    {
      "key": "sports_context",
      "title": "Your activity & treatment goals",
      "fields": [
        {"key":"doctor_name","type":"text","label":"Doctor name","required":false},
        {"key":"doctor_number","type":"text","label":"Doctor number","required":false},
        {"key":"occupation_physical_stress","type":"textarea","label":"What is your occupation, and what physical stresses are involved (for example sitting or driving)?","required":false},
        {"key":"sporting_activities_previous_injuries","type":"textarea","label":"Please tell us about your sporting activities and any previous sports injuries.","required":false}
      ]
    },
    {
      "key": "sports_health_screening",
      "title": "Remedial & Sports Massage questions",
      "questions": [
        {"key":"recent_stroke_six_months_to_two_years","type":"yes_no","label":"Have you had a recent stroke within the last 6 months to 2 years?","required":true},
        {"key":"autoimmune_disease_disorder","type":"yes_no","label":"Do you have an auto-immune disease or disorder?","required":true,"follow_up":{"key":"autoimmune_details","type":"text","label":"If yes, please give details."}},
        {"key":"nervous_muscular_disease_disorder","type":"yes_no","label":"Do you have a nervous or muscular disease or disorder?","required":true,"follow_up":{"key":"nervous_muscular_details","type":"text","label":"If yes, please give details."}},
        {"key":"kidney_or_liver_disorder","type":"yes_no","label":"Do you have kidney or liver disease or a related disorder?","required":true},
        {"key":"skin_disease_disorder","type":"yes_no","label":"Do you have a skin disease or disorder?","required":true}
      ]
    }
  ]
}
$json$::jsonb,
'Remedial Sports Massage - Consultation Form.pdf'
FROM consultation_form_sections s
WHERE s.section_key='remedial_sports_massage_screening'
ON CONFLICT (section_id, version_number) DO NOTHING;

INSERT INTO consultation_form_templates(template_key, title)
VALUES ('remedial_sports_massage_consultation', 'Remedial & Sports Massage Consultation')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO consultation_form_template_versions(template_id, version_number, consent_text, settings)
SELECT t.id, 1,
       'I understand that the information I have given is strictly confidential between the therapist and me. All information I have given is correct and I have not left out any information. I accept that the practitioner cannot be held liable for injury, illness or death based on the nature of the treatment. I have chosen to receive this treatment out of my own free will. I acknowledge that this is a non-sexual service and that sexual advances will not be tolerated, and that the treatment may be stopped if this is breached at any time and the fee will still be payable. I acknowledge that the treatment is not a substitute for medical intervention or treatment and that no results are 100% guaranteed.',
       '{"signature_required":true,"signed_name_required":true,"signed_date_required":true,"practitioner_assessment":"remedial_sports_v1"}'::jsonb
FROM consultation_form_templates t
WHERE t.template_key='remedial_sports_massage_consultation'
ON CONFLICT (template_id, version_number) DO NOTHING;

INSERT INTO consultation_form_template_sections(template_version_id, section_version_id, position)
SELECT tv.id, sv.id, x.position
FROM consultation_form_template_versions tv
JOIN consultation_form_templates t ON t.id=tv.template_id
JOIN LATERAL (
  VALUES
    ('core_massage_consultation'::text, 1),
    ('remedial_sports_massage_screening'::text, 2)
) AS x(section_key, position) ON TRUE
JOIN consultation_form_sections s ON s.section_key=x.section_key
JOIN consultation_form_section_versions sv ON sv.section_id=s.id AND sv.version_number=1
WHERE t.template_key='remedial_sports_massage_consultation'
  AND tv.version_number=1
ON CONFLICT (template_version_id, section_version_id) DO NOTHING;

-- Map the form only to exact active Sports Massage services. The package session is
-- included by its canonical Shiloh package identity so prepaid sessions follow the
-- same consultation requirement without relying on fuzzy runtime name matching.
DO $sports_forms$
DECLARE
  v_template_version_id BIGINT;
  v_mapped INTEGER;
BEGIN
  SELECT tv.id INTO STRICT v_template_version_id
    FROM consultation_form_template_versions tv
    JOIN consultation_form_templates t ON t.id=tv.template_id
   WHERE t.template_key='remedial_sports_massage_consultation'
     AND tv.version_number=1;

  INSERT INTO consultation_form_service_mappings(service_id, template_version_id, required)
  SELECT svc.id, v_template_version_id, TRUE
    FROM services svc
   WHERE svc.status='active'
     AND (
       svc.name IN (
         'Full Body Sports Massage',
         'Targeted Area-Specific Sports Massage',
         'Bamboo Sports Massage - Area Specific'
       )
       OR (svc.external_source='shiloh_package' AND svc.external_id='sports-massage-monthly-session')
     )
  ON CONFLICT (service_id, template_version_id) DO UPDATE SET required=TRUE;

  SELECT COUNT(*)::int INTO v_mapped
    FROM consultation_form_service_mappings m
    JOIN services svc ON svc.id=m.service_id
   WHERE m.template_version_id=v_template_version_id
     AND m.required=TRUE
     AND svc.status='active';

  IF v_mapped < 3 THEN
    RAISE EXCEPTION 'Expected at least three active Sports Massage services for remedial consultation mapping; found %', v_mapped;
  END IF;
END
$sports_forms$;

-- Practitioner assessment is deliberately separate from the signed client answers.
-- The entire clinical record payload is encrypted by the application with the same
-- consultation-form data key; no posture, pain or treatment notes are plaintext.
CREATE TABLE IF NOT EXISTS consultation_form_practitioner_records (
  assignment_id BIGINT PRIMARY KEY
    REFERENCES consultation_form_assignments(id) ON DELETE RESTRICT,
  payload_schema_version INTEGER NOT NULL DEFAULT 1
    CHECK (payload_schema_version = 1),
  payload_ciphertext TEXT NOT NULL
    CHECK (CHAR_LENGTH(payload_ciphertext) BETWEEN 1 AND 131072),
  payload_iv TEXT NOT NULL
    CHECK (payload_iv ~ '^[A-Za-z0-9_-]{16}$'),
  payload_auth_tag TEXT NOT NULL
    CHECK (payload_auth_tag ~ '^[A-Za-z0-9_-]{22}$'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id) ON DELETE RESTRICT,
  updated_by_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE consultation_form_practitioner_records IS
  'Encrypted practitioner-only consultation assessment records, separate from signed client answers.';

-- Clinical form editing is a distinct capability. Senior clinic principals receive
-- business-wide authority. Linked practitioners receive only own-appointment Forms
-- access and clinical record management; Reception keeps status-only access.
UPDATE staff_admin_accounts
   SET permissions = COALESCE(permissions, '{}'::jsonb) || '{"forms:clinical_manage":true}'::jsonb,
       updated_at = NOW()
 WHERE active=TRUE
   AND business_role IN ('owner','business_admin')
   AND COALESCE((permissions ->> 'forms:clinical_manage')::boolean, FALSE) IS NOT TRUE;

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
