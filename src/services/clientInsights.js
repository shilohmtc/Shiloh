'use strict';
const { pool } = require('../db/pool');
const workspaceClients = require('./workspaceClients');
const {
  relationshipPredicate,
  appointmentScopePredicate,
  validClientScope,
} = require('./clientRelationshipScope');
const { endedAttendedSql, recordedEventKeySql, boundedVisitRead } = require('./recordedVisitRead');
const {
  MAX_INSIGHT_RECORDS,
  INSIGHT_PAGE_SIZE,
  insightPeriod,
  insightAverageWindows,
  projectClientInsights,
  insightComparisonPeriod,
  projectInsightComparison,
} = require('../domain/clientInsights');

function createClientInsightsService({
  db = pool,
  accessService = workspaceClients,
  now = () => new Date(),
} = {}) {
  async function getModel({ adminId, months = 2, offset = 0 } = {}) {
    const authority = await accessService.requireAccess(adminId);
    const period = insightPeriod(months, now());
    const safeOffset = Math.min(100000, Math.max(0, Number.parseInt(offset, 10) || 0));
    const scope = authority.clientScope;
    if (!validClientScope(scope))
      return { ...projectClientInsights(null, period, safeOffset), authority };
    const rel = relationshipPredicate('rel', scope, 3);
    const appointments = appointmentScopePredicate('a.id', scope, 3);
    const otherAppointments = appointmentScopePredicate('other.id', scope, 3);
    const visibleTreatment =
      scope.kind === 'tenant_staff'
        ? 'visibility.owner_staff_id=$3'
        : 'visibility.service_id IS NULL';
    const offsetParam = '$' + rel.nextParameterIndex;
    const result = await boundedVisitRead(db, (client) =>
      client.query(
        `/* clientInsights:scoped-period */
      WITH authorized AS MATERIALIZED (
        SELECT c.id,c.name,rel.status FROM crm_v2_clients c
        JOIN crm_v2_client_relationships rel ON rel.client_id=c.id WHERE ${rel.sql}
      ), records AS MATERIALIZED (
        SELECT a.id,a.crm_v2_client_id AS client_id,a.starts_at,a.ends_at,gm.group_id,${recordedEventKeySql('a')} AS event_key
        FROM appointments a JOIN authorized c ON c.id=a.crm_v2_client_id
        LEFT JOIN appointment_group_members gm ON gm.appointment_id=a.id
        WHERE a.client_id IS NULL AND ${endedAttendedSql('a', '$2::timestamptz')}
          AND a.starts_at>=($1::date::timestamp AT TIME ZONE 'Africa/Johannesburg')
          AND a.starts_at<$2::timestamptz AND ${appointments.sql}
        ORDER BY a.starts_at DESC,a.id DESC LIMIT ${MAX_INSIGHT_RECORDS + 1}
      ), count_check AS (SELECT COUNT(*)::int AS record_count FROM records), events AS MATERIALIZED (
        SELECT r.client_id,r.event_key,MIN(r.starts_at) AS starts_at,MAX(r.ends_at) AS ends_at
        FROM records r WHERE (SELECT record_count FROM count_check)<=${MAX_INSIGHT_RECORDS}
        GROUP BY r.client_id,r.event_key
      ), group_check AS (
        SELECT EXISTS(SELECT 1 FROM records r
          JOIN appointment_group_members other_member ON other_member.group_id=r.group_id
          JOIN appointments other ON other.id=other_member.appointment_id
          WHERE (SELECT record_count FROM count_check)<=${MAX_INSIGHT_RECORDS}
            AND other.crm_v2_client_id=r.client_id AND other.client_id IS NULL
            AND ${endedAttendedSql('other', '$2::timestamptz')} AND ${otherAppointments.sql}
            AND (other.starts_at AT TIME ZONE 'Africa/Johannesburg')::date<>(r.starts_at AT TIME ZONE 'Africa/Johannesburg')::date
        ) AS split_group
      ), client_counts AS MATERIALIZED (
        SELECT e.client_id,COUNT(*)::int AS visits,MAX(e.starts_at) AS last_visit_at,
          jsonb_agg(DISTINCT TO_CHAR(e.starts_at AT TIME ZONE 'Africa/Johannesburg','YYYY-MM-DD') ORDER BY TO_CHAR(e.starts_at AT TIME ZONE 'Africa/Johannesburg','YYYY-MM-DD')) AS dates
        FROM events e GROUP BY e.client_id
      ), ranked AS MATERIALIZED (
        SELECT cc.*,c.name,c.status,DENSE_RANK() OVER(ORDER BY cc.visits DESC) AS rank
        FROM client_counts cc JOIN authorized c ON c.id=cc.client_id
      ), page AS (
        SELECT * FROM ranked ORDER BY visits DESC,LOWER(name),client_id LIMIT ${INSIGHT_PAGE_SIZE} OFFSET ${offsetParam}::int
      ), page_treatments AS MATERIALIZED (
        SELECT r.client_id,r.event_key,aps.service_id,MAX(r.starts_at) AS latest,
          (ARRAY_AGG(NULLIF(BTRIM(aps.service_name_snapshot),'') ORDER BY r.starts_at DESC,r.id DESC,aps.position)
            FILTER (WHERE NULLIF(BTRIM(aps.service_name_snapshot),'') IS NOT NULL))[1] AS name
        FROM page p JOIN records r ON r.client_id=p.client_id
        JOIN appointment_services aps ON aps.appointment_id=r.id
        LEFT JOIN service_visibility_policies visibility ON visibility.service_id=aps.service_id AND visibility.visibility_scope='tenant_private'
        WHERE ${visibleTreatment}
        GROUP BY r.client_id,r.event_key,aps.service_id
      ), treatment_frequencies AS MATERIALIZED (
        SELECT client_id,service_id,(ARRAY_AGG(name ORDER BY latest DESC,event_key))[1] AS name,COUNT(*)::int AS visits
        FROM page_treatments WHERE name IS NOT NULL AND service_id IS NOT NULL GROUP BY client_id,service_id
      ), treatment_leaders AS MATERIALIZED (
        SELECT f.* FROM treatment_frequencies f WHERE f.visits=(SELECT MAX(top.visits) FROM treatment_frequencies top WHERE top.client_id=f.client_id)
      ), treatment_summaries AS (
        SELECT p.client_id,
          (SELECT COUNT(*)::int FROM events e WHERE e.client_id=p.client_id AND (
            NOT EXISTS(SELECT 1 FROM page_treatments t WHERE t.client_id=e.client_id AND t.event_key=e.event_key)
            OR EXISTS(SELECT 1 FROM page_treatments t WHERE t.client_id=e.client_id AND t.event_key=e.event_key AND (t.name IS NULL OR t.service_id IS NULL)))) AS missing_visits,
          (SELECT COUNT(*)::int FROM treatment_leaders l WHERE l.client_id=p.client_id) AS leader_count,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('name',LEFT(l.name,160),'visits',l.visits) ORDER BY l.name,l.service_id)
            FROM (SELECT * FROM treatment_leaders WHERE client_id=p.client_id ORDER BY name,service_id LIMIT 3) l),'[]'::jsonb) AS leaders
        FROM page p
      ), average_windows AS (
        SELECT * FROM jsonb_to_recordset($${rel.nextParameterIndex + 1}::jsonb) AS w(kind text,"startDate" date,"endDate" date)
      ), average_counts AS (
        SELECT w.kind,(SELECT COUNT(DISTINCT e.client_id)::int FROM events e
          WHERE e.starts_at>=(w."startDate"::timestamp AT TIME ZONE 'Africa/Johannesburg')
            AND e.starts_at<(w."endDate"::timestamp AT TIME ZONE 'Africa/Johannesburg')
            AND e.ends_at<=(w."endDate"::timestamp AT TIME ZONE 'Africa/Johannesburg')) AS clients
        FROM average_windows w
      ), averages AS (
        SELECT k.kind,COUNT(c.kind)::int AS periods,COALESCE(SUM(c.clients),0)::int AS client_periods
        FROM (VALUES ('day'),('week'),('month')) k(kind)
        LEFT JOIN average_counts c ON c.kind=k.kind GROUP BY k.kind
      ), months AS (
        SELECT TO_CHAR(month,'YYYY-MM') AS month,
          (SELECT COUNT(*)::int FROM events e WHERE TO_CHAR(e.starts_at AT TIME ZONE 'Africa/Johannesburg','YYYY-MM')=TO_CHAR(month,'YYYY-MM')) AS visits,
          (SELECT COUNT(DISTINCT e.client_id)::int FROM events e WHERE TO_CHAR(e.starts_at AT TIME ZONE 'Africa/Johannesburg','YYYY-MM')=TO_CHAR(month,'YYYY-MM')) AS clients
        FROM generate_series($1::date::timestamp,$1::date::timestamp+INTERVAL '1 month'*${period.months - 1},INTERVAL '1 month') month
      )
      SELECT cc.record_count,gc.split_group,
        (SELECT jsonb_agg(jsonb_build_object('kind',kind,'periods',periods,'clientPeriods',client_periods)) FROM averages) AS averages,
        (SELECT COUNT(*)::int FROM events) AS total_visits,
        (SELECT COUNT(*)::int FROM client_counts) AS unique_clients,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('month',m.month,'visits',m.visits,'clients',m.clients) ORDER BY m.month) FROM months m),'[]') AS monthly,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('clientId',p.client_id::text,'name',LEFT(p.name,120),'status',p.status,'visits',p.visits,'rank',p.rank,'lastVisitAt',p.last_visit_at,'dates',p.dates,'treatment',jsonb_build_object('missingVisits',t.missing_visits,'leaderCount',t.leader_count,'leaders',t.leaders)) ORDER BY p.visits DESC,LOWER(p.name),p.client_id) FROM page p JOIN treatment_summaries t ON t.client_id=p.client_id),'[]') AS ranking
      FROM count_check cc CROSS JOIN group_check gc`,
        [
          period.startDate,
          period.asOf,
          ...rel.values,
          safeOffset,
          JSON.stringify(insightAverageWindows(period)),
        ],
      ),
    );
    const model = projectClientInsights(result?.rows?.[0], period, safeOffset);
    if (!model.available) return { ...model, authority };
    const comparisonPeriod = insightComparisonPeriod(period.asOf);
    // Separate bounded read keeps the existing selected-period totals, ordering,
    // limits and failure behavior unchanged. A failed comparison is never zero.
    const comparisonResult = await boundedVisitRead(db, (client) =>
      client.query(
        `/* clientInsights:same-date-comparison */
      WITH windows AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS w(month text,"startDate" date,"endAt" timestamptz)
      ), authorized AS MATERIALIZED (
        SELECT c.id FROM crm_v2_clients c
        JOIN crm_v2_client_relationships rel ON rel.client_id=c.id WHERE ${rel.sql}
      ), records AS MATERIALIZED (
        SELECT a.id,a.crm_v2_client_id AS client_id,a.starts_at,gm.group_id,w.month
        FROM appointments a JOIN authorized c ON c.id=a.crm_v2_client_id
        JOIN windows w ON a.starts_at>=(w."startDate"::timestamp AT TIME ZONE 'Africa/Johannesburg')
          AND a.starts_at<w."endAt"
        LEFT JOIN appointment_group_members gm ON gm.appointment_id=a.id
        WHERE a.client_id IS NULL AND ${endedAttendedSql('a', 'w."endAt"')}
          AND ${appointments.sql}
        ORDER BY a.starts_at DESC,a.id DESC LIMIT ${MAX_INSIGHT_RECORDS + 1}
      ), count_check AS (SELECT COUNT(*)::int AS record_count FROM records), group_check AS (
        SELECT EXISTS(SELECT 1 FROM records r
          JOIN appointment_group_members other_member ON other_member.group_id=r.group_id
          JOIN appointments other ON other.id=other_member.appointment_id
          WHERE (SELECT record_count FROM count_check)<=${MAX_INSIGHT_RECORDS}
            AND other.crm_v2_client_id=r.client_id AND other.client_id IS NULL
            AND ${endedAttendedSql('other', '$2::timestamptz')} AND ${otherAppointments.sql}
            AND (other.starts_at AT TIME ZONE 'Africa/Johannesburg')::date<>(r.starts_at AT TIME ZONE 'Africa/Johannesburg')::date
        ) AS split_group
      ), months AS (
        SELECT w.month,COUNT(DISTINCT r.client_id)::int AS clients
        FROM windows w LEFT JOIN records r ON r.month=w.month
          AND (SELECT record_count FROM count_check)<=${MAX_INSIGHT_RECORDS}
        GROUP BY w.month
      )
      SELECT cc.record_count,gc.split_group,
        (SELECT jsonb_agg(jsonb_build_object('month',m.month,'clients',m.clients) ORDER BY m.month) FROM months m) AS monthly
      FROM count_check cc CROSS JOIN group_check gc`,
        [JSON.stringify(comparisonPeriod.windows), period.asOf, ...rel.values],
      ),
    );
    return {
      ...model,
      comparison: projectInsightComparison(comparisonResult?.rows?.[0], comparisonPeriod),
      authority,
    };
  }
  return { getModel };
}
module.exports = { createClientInsightsService };
