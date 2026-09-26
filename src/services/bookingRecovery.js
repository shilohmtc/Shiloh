// Read-only recovery context. The payment service must authorize the appointment before this query runs.
async function consultationRecovery(db, appointmentId) {
  const result = await db.query(
    `SELECT a.status,a.access_expires_at,a.access_token_hash IS NOT NULL AS has_access_token
       FROM consultation_form_assignments a
      WHERE a.appointment_id=$1
      ORDER BY a.id`,
    [appointmentId],
  );
  return result.rows.map((row) => ({
    status: String(row.status),
    linkAvailable: Boolean(row.has_access_token && row.access_expires_at && new Date(row.access_expires_at).getTime() > Date.now()),
  }));
}

module.exports = { consultationRecovery };
