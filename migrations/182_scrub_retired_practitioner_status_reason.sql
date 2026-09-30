-- Earlier attendance recovery named a now-offboarded practitioner in a
-- shared status explanation. Keep each appointment event and neutralize only
-- that practitioner attribution, without changing client records.
UPDATE appointment_status_history
   SET reason = REPLACE(reason,
     'Christel/Marietjie can perform final practitioner certification',
     'an authorized practitioner can perform final practitioner certification')
 WHERE changed_by = 'system:approved-historical-attendance-reopen-2026-08-16'
   AND reason = 'Approved historical attendance reopen so Christel/Marietjie can perform final practitioner certification through Admin Finalize past visits';
