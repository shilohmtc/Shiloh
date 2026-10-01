const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const { createFixture, REVISION } = require('../scripts/calendar-operational-mutations-browser-proof');

test('reassignment recovery requires management permission AND exact service scope, without writes', async () => {
  const { app, state } = createFixture();
  state.recoveryFailure = 'CALENDAR_OPERATION_SERVICE_MAPPING';
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${origin}/proof/christel`, { redirect: 'manual' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    for (const [manage, scope, link] of [[false, true, false], [true, false, false], [true, true, true]]) {
      state.recoveryManage = manage;
      state.recoveryScope = scope;
      const token = await (await fetch(`${origin}/calendar/staff-auth/csrf`, { method: 'POST', headers: { Cookie: cookie, Origin: origin.replace('http:', 'https:'), 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' }, body: '{}' })).json();
      const response = await fetch(`${origin}/calendar/operations/appointments/7001/reassign`, {
        method: 'POST', headers: { Cookie: cookie, Origin: origin.replace('http:', 'https:'), 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', 'x-shiloh-csrf-token': token.csrfToken },
        body: JSON.stringify({ destinationStaffId: 2, expectedRevision: REVISION, requestId: 'recovery_test_request' }),
      });
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.equal(body.code, 'CALENDAR_OPERATION_SERVICE_MAPPING');
      assert.equal(body.recovery.kind, 'service_mapping');
      assert.equal(body.recovery.serviceHref, link ? '/calendar/services/901#service-practitioners' : undefined);
      assert.equal(state.operations.length, 0);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('every changed generated script compiles', () => {
  for (const file of fs.readdirSync('src/presentation').filter(name => name.endsWith('.js'))) {
    const presentation = require(`../src/presentation/${file}`);
    for (const [name, render] of Object.entries(presentation)) {
      if (/ClientScript$/.test(name) && typeof render === 'function') assert.doesNotThrow(() => new vm.Script(render()), `${file}: ${name}`);
    }
  }
});
