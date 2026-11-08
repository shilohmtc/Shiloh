'use strict';

const { relationshipPredicate, appointmentScopePredicate, validClientScope } = require('./clientRelationshipScope');
const { MAX_APPOINTMENTS, projectRecordedVisits } = require('../domain/clientRecordedVisits');
const { endedAttendedSql, recordedEventKeySql, boundedVisitRead } = require('./recordedVisitRead');

// One bounded batch for authorized profile summaries.
// No phone/name/organiser matching, ledger getters, writes or cached private data.
async function readClientRecordedVisits({ db, clientIds = [], scope, asOf = new Date() } = {}) {
  const ids = [...new Set(clientIds.map(String))];
  const unavailable = Object.fromEntries(ids.map(id => [id, { available: false }]));
  if (!ids.length || ids.length > 24 || ids.some(id => !/^[1-9]\d*$/.test(id)) || !validClientScope(scope) || !Number.isFinite(new Date(asOf).getTime()) || typeof db?.connect !== 'function') return unavailable;
  const relationship = relationshipPredicate('rel', scope, 3);
  const appointments = appointmentScopePredicate('a.id', scope, 3);
  const tenant = scope.kind === 'tenant_staff';
  const visibleService = tenant ? "visibility.owner_staff_id=$3" : 'visibility.service_id IS NULL';
  const result = await boundedVisitRead(db, client => client.query(`/* clientRecordedVisits:scoped-batch */
      WITH authorized AS MATERIALIZED (
        SELECT c.id FROM crm_v2_clients c
        WHERE c.id=ANY($1::bigint[]) AND EXISTS (
          SELECT 1 FROM crm_v2_client_relationships rel WHERE rel.client_id=c.id AND ${relationship.sql})
      ), bounds AS (
        SELECT (($2::timestamptz AT TIME ZONE 'Africa/Johannesburg')::date - INTERVAL '12 months')::date AS first_date
      ), records AS MATERIALIZED (
        SELECT visible.*, ${recordedEventKeySql('visible')} AS event_key
        FROM authorized c CROSS JOIN LATERAL (
          SELECT a.id,a.crm_v2_client_id AS client_id,a.starts_at
          FROM appointments a WHERE a.crm_v2_client_id=c.id AND a.client_id IS NULL
            AND ${endedAttendedSql('a', '$2::timestamptz')} AND ${appointments.sql}
          ORDER BY a.starts_at DESC,a.id DESC LIMIT ${MAX_APPOINTMENTS + 1}
        ) visible LEFT JOIN appointment_group_members gm ON gm.appointment_id=visible.id
      ), record_counts AS MATERIALIZED (
        SELECT client_id,COUNT(*)::int AS record_count FROM records GROUP BY client_id
      ), events AS MATERIALIZED (
        SELECT r.client_id,r.event_key,MIN(r.starts_at) AS starts_at,
          COUNT(DISTINCT (r.starts_at AT TIME ZONE 'Africa/Johannesburg')::date)>1 AS split_group
        FROM records r JOIN record_counts rc ON rc.client_id=r.client_id AND rc.record_count<=${MAX_APPOINTMENTS}
        GROUP BY r.client_id,r.event_key
      ), recent AS MATERIALIZED (
        SELECT e.*,(e.starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS visit_date
        FROM events e CROSS JOIN bounds b WHERE (e.starts_at AT TIME ZONE 'Africa/Johannesburg')::date>=b.first_date
      ), treatments AS MATERIALIZED (
        SELECT r.client_id,r.event_key,aps.service_id,MAX(r.starts_at) AS latest,
          (ARRAY_AGG(NULLIF(BTRIM(aps.service_name_snapshot),'') ORDER BY r.starts_at DESC,r.id DESC,aps.position)
            FILTER (WHERE NULLIF(BTRIM(aps.service_name_snapshot),'') IS NOT NULL))[1] AS name
        FROM recent e JOIN records r ON r.client_id=e.client_id AND r.event_key=e.event_key
        JOIN appointment_services aps ON aps.appointment_id=r.id
        LEFT JOIN service_visibility_policies visibility ON visibility.service_id=aps.service_id AND visibility.visibility_scope='tenant_private'
        WHERE ${visibleService}
        GROUP BY r.client_id,r.event_key,aps.service_id
      ), frequencies AS MATERIALIZED (
        SELECT client_id,service_id,(ARRAY_AGG(name ORDER BY latest DESC,event_key))[1] AS name,COUNT(*)::int AS visits
        FROM treatments WHERE name IS NOT NULL AND service_id IS NOT NULL GROUP BY client_id,service_id
      ), leaders AS MATERIALIZED (
        SELECT f.* FROM frequencies f WHERE f.visits=(SELECT MAX(top.visits) FROM frequencies top WHERE top.client_id=f.client_id)
      )
      SELECT c.id AS client_id,TO_CHAR(b.first_date,'YYYY-MM-DD') AS period_start,
        COALESCE((SELECT rc.record_count FROM record_counts rc WHERE rc.client_id=c.id),0) AS record_count,
        (SELECT MAX(e.starts_at) FROM events e WHERE e.client_id=c.id) AS last_visit_at,
        EXISTS(SELECT 1 FROM events e WHERE e.client_id=c.id AND e.split_group) AS split_group,
        (SELECT COUNT(*)::int FROM recent e WHERE e.client_id=c.id) AS visit_count,
        COALESCE((SELECT jsonb_agg(TO_CHAR(d.visit_date,'YYYY-MM-DD') ORDER BY d.visit_date) FROM (SELECT DISTINCT visit_date FROM recent WHERE client_id=c.id) d),'[]'::jsonb) AS visit_dates,
        (SELECT COUNT(*)::int FROM recent e WHERE e.client_id=c.id AND (
          NOT EXISTS(SELECT 1 FROM treatments t WHERE t.client_id=c.id AND t.event_key=e.event_key)
          OR EXISTS(SELECT 1 FROM treatments t WHERE t.client_id=c.id AND t.event_key=e.event_key AND (t.name IS NULL OR t.service_id IS NULL)))) AS missing_treatment_visits,
        (SELECT COUNT(*)::int FROM frequencies f WHERE f.client_id=c.id) AS treatment_count,
        (SELECT COUNT(*)::int FROM leaders l WHERE l.client_id=c.id) AS leader_count,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('name',LEFT(l.name,160),'visits',l.visits) ORDER BY l.name,l.service_id) FROM (SELECT * FROM leaders WHERE client_id=c.id ORDER BY name,service_id LIMIT 3) l),'[]'::jsonb) AS leaders
      FROM authorized c CROSS JOIN bounds b`, [ids, new Date(asOf).toISOString(), ...(tenant ? [scope.ownerStaffId] : [])]));
  if (!result) return unavailable;
  try {
    const answer = { ...unavailable };
    for (const row of result.rows) if (Object.hasOwn(answer, String(row.client_id))) answer[String(row.client_id)] = projectRecordedVisits(row, asOf);
    return answer;
  } catch (_) {
    return unavailable;
  }
}

module.exports = { readClientRecordedVisits };
