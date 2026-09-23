const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'services', 'appointmentChange.js'), 'utf8');
const presentation = fs.readFileSync(path.join(root, 'src', 'presentation', 'clientAppointmentChangePresentation.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('destructive cancellation review uses deterministic confirm/keep buttons', () => {
  assert.match(source, /Please confirm the cancellation:/);
  assert.match(source, /cancellationTerms\(a\)/);
  assert.match(presentation, /type:\s*['"]button['"]/);
  assert.match(presentation, /id:\s*['"]yes['"],\s*title:\s*['"]Confirm cancellation['"]/);
  assert.match(presentation, /id:\s*['"]stop['"],\s*title:\s*['"]Keep appointment['"]/);
  assert.match(presentation, /Nothing has changed yet\./);
});

test('typed YES and STOP remain supported as cancellation fallbacks', () => {
  assert.match(source, /function isConfirmation/);
  assert.match(source, /function isAbort/);
  assert.match(source, /Reply \*YES\* to cancel this booking, or \*STOP\*/);
  assert.match(presentation, /type \*YES\* to cancel or \*STOP\* to keep/);
});

test('presentation decorator is installed before webhook routes capture the service export', () => {
  const decorate = app.indexOf('appointmentChangeService.processAppointmentChangeMessage = async');
  const routes = app.indexOf('const webhookRoutes = require');
  assert.ok(decorate >= 0 && routes > decorate);
});

test('cancellation review does not perform the canonical cancellation before explicit confirmation', () => {
  const review = source.indexOf('Please confirm the cancellation:');
  const cancelWrite = source.indexOf('await cancelCanonical', review);
  assert.ok(review >= 0 && cancelWrite > review);
});
