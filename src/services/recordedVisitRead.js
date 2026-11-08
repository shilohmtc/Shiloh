'use strict';

// Shared by profile summaries and Insights. Attendance never comes from price,
// payment, a parent booking status, phone matching or organiser identity.
function endedAttendedSql(alias, asOf) {
  return `${alias}.status IN ('completed','no_charge') AND ${alias}.starts_at<=${asOf}
    AND ${alias}.ends_at<=${asOf} AND ${alias}.ends_at>${alias}.starts_at`;
}
function recordedEventKeySql(appointmentAlias, groupAlias = 'gm') {
  return `COALESCE('g:'||${groupAlias}.group_id::text,'a:'||${appointmentAlias}.id::text)`;
}
async function boundedVisitRead(db, work) {
  if (typeof db?.connect !== 'function') return null;
  let client,
    acquisition,
    timedOut = false;
  try {
    const pending = Promise.resolve(db.connect());
    pending
      .then((late) => {
        if (timedOut) late.release();
      })
      .catch(() => {});
    client = await Promise.race([
      pending,
      new Promise((_, reject) => {
        acquisition = setTimeout(() => {
          timedOut = true;
          reject(Error('VISIT_READ_ACQUIRE_TIMEOUT'));
        }, 3000);
      }),
    ]);
    clearTimeout(acquisition);
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='2000ms'");
    await client.query("SET LOCAL lock_timeout='250ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='3000ms'");
    return await work(client);
  } catch (_) {
    return null;
  } finally {
    clearTimeout(acquisition);
    if (client) {
      let rollbackError;
      try {
        await client.query('ROLLBACK');
      } catch (error) {
        rollbackError = error;
      }
      client.release(rollbackError);
    }
  }
}
module.exports = { endedAttendedSql, recordedEventKeySql, boundedVisitRead };
