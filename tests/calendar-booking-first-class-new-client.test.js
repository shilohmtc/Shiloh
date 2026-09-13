const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CLIENT_BROWSE_QUERY,
  calendarCreateBookingClientChoiceScript,
} = require('../src/presentation/calendarCreateBookingClientChoiceUx');
const {
  renderCalendarCreateBookingPage,
  calendarCreateBookingClientScript,
} = require('../src/presentation/calendarCreateBookingUx');

test('Calendar booking presents Existing clients first, with Search clients secondary and Add new client explicit', () => {
  const script = calendarCreateBookingClientChoiceScript();

  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /Existing clients/);
  assert.match(script, /Search clients/);
  assert.match(script, /Add new client/);
  assert.doesNotMatch(script, /Find existing client|\+ New client|Client registration/);
  assert.match(script, /data-client-mode-existing/);
  assert.match(script, /data-client-mode-search/);
  assert.match(script, /data-client-mode-new/);
  assert.match(script, /Choose client/);
  assert.match(script, /Search by name or mobile number/);
  assert.doesNotMatch(script, /CRM V2/);
});

test('Existing-client choice loads a bounded browse request through the canonical guarded search control', () => {
  const script = calendarCreateBookingClientChoiceScript();

  assert.equal(CLIENT_BROWSE_QUERY, '__shiloh_calendar_active_clients_v1__');
  assert.match(script, /var BROWSE_QUERY='__shiloh_calendar_active_clients_v1__'/);
  assert.match(script, /function loadExistingClients\(\)\{setStatus\('Loading existing clients…'\);search\.value=BROWSE_QUERY;searchAction\.click\(\);search\.value=''\;\}/);
  assert.match(script, /setMode\('browse'\);\nloadExistingClients\(\);/);
  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.doesNotMatch(script, /XMLHttpRequest/);
});

test('New-client choice opens directly with Name and Mobile and synchronizes the draft without a visible second confirmation', () => {
  const script = calendarCreateBookingClientChoiceScript();

  assert.match(script, /newButton\.addEventListener\('click'/);
  assert.match(script, /setMode\('new'\)/);
  assert.match(script, /newPanel\.hidden=!isNew/);
  assert.match(script, /useNewActions\.hidden=true/);
  assert.match(script, /newHint\.hidden=true/);
  assert.match(script, /function syncNewClientDraftFromFields\(\)/);
  assert.match(script, /newName\.addEventListener\('input',syncNewClientDraftFromFields\)/);
  assert.match(script, /newMobile\.addEventListener\('input',syncNewClientDraftFromFields\)/);
  assert.match(script, /useNew\.click\(\)/);
  assert.doesNotMatch(script, /identity key|CRM V2/);
  assert.doesNotMatch(script, /Enter the new client’s name and South African mobile number/);
  assert.match(script, /if\(newName\)newName\.focus\(\)/);
});

test('Client-choice enhancement cannot write CRM or bypass guarded booking authority', () => {
  const script = calendarCreateBookingClientChoiceScript();

  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.doesNotMatch(script, /XMLHttpRequest/);
  assert.doesNotMatch(script, /\/prepare/);
  assert.doesNotMatch(script, /\/confirm/);
  assert.doesNotMatch(script, /\/client-search/);
  assert.doesNotMatch(script, /clientId\s*:/);
  assert.doesNotMatch(script, /newClient\s*:/);
});

test('Switching picker modes clears stale selection while Review booking remains available for feedback', () => {
  const script = calendarCreateBookingClientChoiceScript();

  assert.match(script, /clearVisibleSelection\(\);if\(review\)review\.disabled=false;setMode\('browse'\);loadExistingClients\(\)/);
  assert.match(script, /clearVisibleSelection\(\);if\(review\)review\.disabled=false;setMode\('search'\)/);
  assert.match(script, /clearVisibleSelection\(\);if\(review\)review\.disabled=false;setMode\('new'\);syncNewClientDraftFromFields\(\)/);
  assert.doesNotMatch(script, /review\.disabled=true/);
  assert.match(script, /calendar-client-mode/);
  assert.match(script, /if\(!preserveSelection\)window\.dispatchEvent/);
  assert.match(script, /detail:\{mode:'new'\}/);
  assert.match(script, /setMode\('browse',true\)/);
  assert.match(script, /if\(review\)review\.disabled=false/);
  assert.match(script, /data-client-selection/);
  assert.match(script, /getAttribute\('data-client-selection'\)==='existing'/);
});

test('Review booking is enabled after client JavaScript loads and reports the first missing requirement nearby', () => {
  const html = renderCalendarCreateBookingPage();
  const script = calendarCreateBookingClientScript();

  assert.match(html, /data-review-booking disabled>Review booking/);
  assert.match(html, /data-booking-status/);
  assert.match(html, /aria-live="polite"/);
  assert.match(script, /el\('\[data-review-booking\]'\)\.disabled=false;/);
  assert.match(script, /if\(!node\)return;node\.hidden=false;node\.textContent=message/);
  assert.doesNotMatch(script, /disabled=!selectedClient&&!newClientDraft/);
  assert.match(script, /Choose Find client or New client and complete that selection first\./);
  assert.match(script, /setStatus\(start\.message,'error'\)/);
  assert.match(script, /Choose treatment and eligible practitioner\./);
});
