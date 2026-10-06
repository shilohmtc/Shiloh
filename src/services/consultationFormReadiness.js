'use strict';

// Existing required treatment mappings and assigned forms are the authority.
// A status alone cannot replace the signed submission saved by the form service.
function requiredFormVersionsSql(appointmentAlias = 'ap') {
  return `SELECT m.template_version_id FROM appointment_services aps
    JOIN consultation_form_service_mappings m ON m.service_id=aps.service_id AND m.required=TRUE
    WHERE aps.appointment_id=${appointmentAlias}.id
    UNION SELECT existing.template_version_id FROM consultation_form_assignments existing
    WHERE existing.appointment_id=${appointmentAlias}.id`;
}

function projectRequiredForm(row) {
  const completed = row.status === 'completed' && Number(row.submission_id) > 0;
  return {
    id: row.id == null ? null : Number(row.id),
    versionId: Number(row.template_version_id),
    status: completed ? 'completed' : row.status === 'completed' ? 'needs_review' : String(row.status || 'not_assigned'),
    templateKey: String(row.template_key || ''),
    title: String(row.title || 'Consultation form'),
    submissionId: row.submission_id == null ? null : Number(row.submission_id),
    actionRequired: !completed,
    canComplete: !completed && ['not_sent', 'sent', 'opened'].includes(row.status) && Number(row.id) > 0,
  };
}

function requiredFormsReadiness(forms = []) {
  const outstanding = forms.filter(form => form.actionRequired);
  return { ready: outstanding.length === 0, required: forms.length, outstanding: outstanding.length,
    label: outstanding.length ? 'Required forms outstanding' : forms.length ? 'Required forms complete' : 'No form required' };
}

module.exports = { requiredFormVersionsSql, projectRequiredForm, requiredFormsReadiness };
