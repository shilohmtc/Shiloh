'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  calendarAppointmentCompactEditorStyles,
  calendarAppointmentCompactEditorClientScript,
} = require('../src/presentation/calendarAppointmentCompactEditorUx');

test('appointment editor becomes a one-section-at-a-time compact drawer', () => {
  const styles = calendarAppointmentCompactEditorStyles();
  const script = calendarAppointmentCompactEditorClientScript();

  assert.match(styles, /width:min\(520px,100%\)/);
  assert.match(styles, /overflow:auto/);
  assert.match(styles, /height:min\(92dvh,780px\)/);
  assert.match(script, /Notes/);
  assert.match(script, /Treatment & price/);
  assert.match(script, /Date & time/);
  assert.match(script, /Practitioner/);
  assert.match(script, /Cancel appointment/);
  assert.match(script, /closeOthers\(button\)/);
  assert.match(script, /aria-expanded/);
  assert.match(script, /data-panel-action="appointment:reschedule"/);
  assert.match(script, /data-end-time-form/);
  assert.doesNotThrow(() => new Function(script));
});

test('both appointment-operation client routes append the compact editor last', () => {
  const endTimeRoute = fs.readFileSync(path.join(__dirname, '../src/routes/calendarAppointmentEndTime.js'), 'utf8');
  const fallbackRoute = fs.readFileSync(path.join(__dirname, '../src/routes/calendarOperationalMutations.js'), 'utf8');

  assert.match(endTimeRoute, /renderTreatmentPriceClient\(\)\}\\n\$\{renderCompactEditorClient\(\)\}/);
  assert.match(fallbackRoute, /renderNotesClient\(\)\}\\n\$\{renderCompactEditorClient\(\)\}/);
});
