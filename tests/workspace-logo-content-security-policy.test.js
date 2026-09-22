'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { setWorkspaceOperationalSecurityHeaders } = require('../src/routes/workspaceOperational');
const { setWorkspaceClientsSecurityHeaders } = require('../src/routes/workspaceClients');
const { setWorkspaceStaffSecurityHeaders } = require('../src/routes/workspaceStaff');
const { setWorkspaceServicesSecurityHeaders } = require('../src/routes/workspaceServices');
const { setWorkspaceClientNotificationSecurityHeaders } = require('../src/routes/workspaceClientNotifications');
const { setWorkspaceFormsSecurityHeaders } = require('../src/routes/workspaceForms');
const { setWorkspaceReportsSecurityHeaders } = require('../src/routes/workspaceReports');
const { setClinicHoursSecurityHeaders } = require('../src/routes/workspaceClinicHours');

function responseDouble() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) { headers[String(name).toLowerCase()] = String(value); },
  };
}

test('every secured Workspace surface permits the shared Shiloh logo to paint', () => {
  const setters = [
    setWorkspaceOperationalSecurityHeaders,
    setWorkspaceClientsSecurityHeaders,
    setWorkspaceStaffSecurityHeaders,
    setWorkspaceServicesSecurityHeaders,
    setWorkspaceClientNotificationSecurityHeaders,
    setWorkspaceFormsSecurityHeaders,
    setWorkspaceReportsSecurityHeaders,
    setClinicHoursSecurityHeaders,
  ];

  for (const setHeaders of setters) {
    const res = responseDouble();
    setHeaders(res);
    assert.match(res.headers['content-security-policy'], /img-src 'self' data:/, `${setHeaders.name} blocks the shared Workspace logo`);
  }
});
