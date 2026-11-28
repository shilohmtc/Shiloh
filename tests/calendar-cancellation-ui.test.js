const test = require('node:test');
const assert = require('node:assert/strict');

const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');
const { calendarOperationalMutationsClientScript } = require('../src/presentation/calendarOperationalMutationsUx');

function mutableCalendarModel() {
  return {
    view: 'day',
    dateKey: '2026-08-24',
    period: {
      dateKeys: ['2026-08-24'],
      previousAnchor: '2026-08-23',
      nextAnchor: '2026-08-25',
    },
    selectedStaffId: null,
    permittedStaff: [{ id: 1, displayName: 'Julia', schedulingType: 'regular' }],
    timeline: {
      staff: [{ id: 1, displayName: 'Julia', schedulingType: 'regular' }],
      workingWindows: [],
      scheduleExceptions: [],
      recurringClosures: [],
      appointments: [],
      blocks: [],
      leave: [],
      closures: [],
      events: [],
    },
    mutationCapability: {
      enabled: true,
      operations: ['appointment:cancel'],
    },
  };
}

test('Manage Appointment cancellation keeps exact confirmation but no reason input', () => {
  const html = renderCalendarPage(mutableCalendarModel());
  const start = html.indexOf('data-panel-action="appointment:cancel"');
  assert.notEqual(start, -1);
  const end = html.indexOf('</form>', start);
  const cancellationForm = html.slice(start, end);
  assert.match(cancellationForm, /name="confirmed" type="checkbox" required/);
  assert.ok(cancellationForm.includes('>Cancel appointment</button>'));
  assert.doesNotMatch(cancellationForm, /Cancellation reason|name="reason"/i);
});

test('Calendar cancellation client remains confirmation-gated and omits reason from request payload', () => {
  const script = calendarOperationalMutationsClientScript();
  const start = script.indexOf("else if(action==='appointment:cancel')");
  assert.notEqual(start, -1);
  const end = script.indexOf("}});});}", start);
  assert.notEqual(end, -1);
  const cancellationBranch = script.slice(start, end);
  assert.ok(cancellationBranch.includes('if(!form.elements.confirmed.checked)return;'));
  assert.ok(cancellationBranch.includes('confirmation:{confirmed:true,appointmentId:data.id,revision:data.revision,...(activeAppointmentCard.dataset.appointmentGroupId?{linkedGroupId:Number(activeAppointmentCard.dataset.appointmentGroupId)}:{})}'));
  assert.ok(cancellationBranch.includes('requestId:operationId()'));
  assert.equal(cancellationBranch.includes('reason:'), false);
});
