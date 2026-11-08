-- Fixed aggregate-only diagnostic. Execute only inside a bounded READ ONLY snapshot.
WITH facts AS MATERIALIZED (
 SELECT a.id,a.starts_at,a.ends_at,a.created_at,a.client_id,a.crm_v2_client_id,
  CASE WHEN a.status IN ('scheduled','confirmed','completed','no_charge','cancelled','no_show','unknown') THEN a.status ELSE 'other' END AS status,
  CASE WHEN a.source IN ('goldie','goldie_import') THEN 'imported_goldie' WHEN a.source='shiloh' THEN 'shiloh' ELSE 'other' END AS source_bucket,
  CASE WHEN a.client_id IS NOT NULL AND a.crm_v2_client_id IS NOT NULL THEN 'dual'
       WHEN a.crm_v2_client_id IS NOT NULL THEN 'modern' WHEN a.client_id IS NOT NULL THEN 'legacy' ELSE 'missing' END AS linkage,
  (a.client_id IS NOT NULL AND c.id IS NULL) OR (a.crm_v2_client_id IS NOT NULL AND v.id IS NULL) AS missing_reference,
  (SELECT COUNT(*) FROM appointment_group_members gm WHERE gm.appointment_id=a.id) AS memberships
 FROM appointments a LEFT JOIN clients c ON c.id=a.client_id LEFT JOIN crm_v2_clients v ON v.id=a.crm_v2_client_id
), totals AS (
 SELECT COUNT(*)::int AS appointment_records,
 COUNT(*) FILTER (WHERE linkage='modern')::int AS modern_only_records,
 COUNT(*) FILTER (WHERE linkage='legacy')::int AS legacy_only_records,
 COUNT(*) FILTER (WHERE linkage='dual')::int AS dual_link_records,
 COUNT(*) FILTER (WHERE linkage='missing')::int AS missing_link_records,
 COUNT(*) FILTER (WHERE missing_reference)::int AS missing_reference_records,
 COUNT(*) FILTER (WHERE memberships>1)::int AS multiple_membership_records,
 COUNT(*) FILTER (WHERE starts_at IS NULL)::int AS missing_start_records,
 COUNT(*) FILTER (WHERE ends_at IS NULL OR ends_at<=starts_at)::int AS invalid_end_records,
 COUNT(*) FILTER (WHERE status IN ('completed','no_charge'))::int AS recorded_completed_records,
 COUNT(*) FILTER (WHERE status IN ('completed','no_charge') AND starts_at>$1::timestamptz)::int AS future_completed_records,
 COUNT(*) FILTER (WHERE status IN ('completed','no_charge') AND ends_at>$1::timestamptz)::int AS completed_not_ended_records,
 COUNT(DISTINCT crm_v2_client_id) FILTER (WHERE linkage='modern' AND NOT missing_reference AND status IN ('completed','no_charge') AND ends_at>starts_at AND starts_at<=$1::timestamptz AND ends_at<=$1::timestamptz)::int AS observed_modern_completed_profiles,
 COUNT(DISTINCT client_id) FILTER (WHERE linkage='legacy' AND NOT missing_reference AND status IN ('completed','no_charge') AND ends_at>starts_at AND starts_at<=$1::timestamptz AND ends_at<=$1::timestamptz)::int AS observed_legacy_completed_profiles,
 MIN(starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS earliest_observed_date,
 MAX(starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS latest_observed_date,
 MIN(starts_at AT TIME ZONE 'Africa/Johannesburg') FILTER(WHERE status IN ('completed','no_charge') AND ends_at<=$1::timestamptz)::date AS earliest_recorded_completed_date
 FROM facts
), monthly AS (
 SELECT date_trunc('month',starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS month,linkage,status,COUNT(*)::int AS appointment_records
 FROM facts GROUP BY 1,2,3 ORDER BY 1,2,3 LIMIT 1201
), provenance AS (
 SELECT source_bucket,COUNT(*)::int AS appointment_records,
 COUNT(*) FILTER(WHERE status IN ('completed','no_charge'))::int AS recorded_completed_records,
 MIN(created_at AT TIME ZONE 'Africa/Johannesburg')::date AS earliest_record_created_date,
 MAX(created_at AT TIME ZONE 'Africa/Johannesburg')::date AS latest_record_created_date
 FROM facts GROUP BY source_bucket
), reset_audit AS MATERIALIZED (
 SELECT created_at FROM crm_audit_events
 WHERE action='control.calendar_occupancy_reset'
   AND metadata->>'runId'='calendar-reset-2026-08-30-v1'
 ORDER BY id LIMIT 2
), reset_markers AS MATERIALIZED (
 SELECT h.appointment_id,h.from_status,
  (SELECT COUNT(*) FROM reset_audit)=1 AND EXISTS(
   SELECT 1 FROM reset_audit r WHERE r.created_at=h.changed_at
  ) AS audit_matched
 FROM appointment_status_history h
 WHERE h.changed_by='control:00'
   AND h.reason='Authorized clean-calendar occupancy reset #584'
   AND h.to_status='cancelled'
), legacy_reset AS (
 SELECT f.id,f.status,
  COUNT(m.appointment_id)::int AS marker_count,
  COUNT(m.appointment_id) FILTER(WHERE m.audit_matched)::int AS matched_count,
  MIN(CASE WHEN m.from_status IN ('scheduled','confirmed','completed','no_charge','cancelled','no_show','unknown') THEN m.from_status ELSE 'other' END) FILTER(WHERE m.audit_matched) AS prior_status
 FROM facts f LEFT JOIN reset_markers m ON m.appointment_id=f.id
 WHERE f.linkage='legacy' GROUP BY f.id,f.status
), reset_status AS (
 SELECT CASE WHEN matched_count=1 THEN prior_status ELSE 'ambiguous' END AS prior_status,
  status AS current_status,COUNT(*)::int AS appointment_records
 FROM legacy_reset WHERE matched_count>0 GROUP BY 1,2
), reset_summary AS (
 SELECT (SELECT COUNT(*)::int FROM reset_audit) AS audit_events,
 COUNT(*)::int AS legacy_records,
 COUNT(*) FILTER(WHERE marker_count>0)::int AS marker_records,
 COUNT(*) FILTER(WHERE matched_count>0)::int AS matched_records,
 COUNT(*) FILTER(WHERE marker_count>0 AND matched_count=0)::int AS unmatched_marker_records,
 COUNT(*) FILTER(WHERE matched_count>1)::int AS ambiguous_records,
 COALESCE((SELECT jsonb_agg(to_jsonb(reset_status) ORDER BY prior_status,current_status) FROM reset_status),'[]'::jsonb) AS status_counts
 FROM legacy_reset
)
SELECT jsonb_build_object('totals',(SELECT to_jsonb(totals) FROM totals),
 'reset_provenance',(SELECT to_jsonb(reset_summary) FROM reset_summary),
 'monthly_records',COALESCE((SELECT jsonb_agg(to_jsonb(monthly) ORDER BY month,linkage,status) FROM monthly),'[]'::jsonb),
 'source_buckets',COALESCE((SELECT jsonb_agg(to_jsonb(provenance) ORDER BY source_bucket) FROM provenance),'[]'::jsonb)) AS assessment;
