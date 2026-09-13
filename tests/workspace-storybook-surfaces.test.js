'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Storybook workspace catalogue consumes production presentation authorities', () => {
  const story = fs.readFileSync('stories/WorkspaceSurfaces.stories.js', 'utf8');
  assert.match(story, /workspaceDashboardUx\.js/);
  assert.match(story, /workspaceCommunicationEvidenceUx\.js/);
  assert.match(story, /workspaceMessagesUx\.js/);
  assert.match(story, /calendarAppointmentCompactEditorUx\.js/);
  assert.match(story, /calendarCreateBookingUx\.js/);
  assert.match(story, /renderDashboardPage\(dashboardModel\(\)\)/);
  assert.match(story, /renderClientDetailPageWithCommunications\(clientModel\(\)/);
  assert.match(story, /renderMessagesPage\(messagesModel\(\)\)/);
  assert.match(story, /calendarAppointmentCompactEditorClientScript\(\)/);
  assert.match(story, /renderCalendarCreateBookingPage\(/);
});

test('visual gate covers each workspace surface on Desktop and Phone', () => {
  const visual = fs.readFileSync('tests/ux-visual-accessibility.spec.js', 'utf8');
  for (const name of ['dashboard', 'client-history', 'messages', 'appointment-editor']) {
    assert.match(visual, new RegExp(`\\['${name}'`));
  }
  assert.match(visual, /width: 1440, height: 1000/);
  assert.match(visual, /width: 390, height: 844/);
  assert.match(visual, /workspace-production-surfaces--create-booking/);
  assert.match(visual, /Phone controls must retain 44px touch targets/);
  assert.match(visual, /new AxeBuilder/);
  assert.match(visual, /toHaveScreenshot/);
});
