const test = require('node:test');
const assert = require('node:assert/strict');
const {
  productionWrapperDesign,
  retryDecision,
  scratchBudget,
  reconcileUpload,
  failureEvidence,
  runObservation,
  createFixtureOAuthAdapter,
  DRIVE_FILE_SCOPE,
} = require('../scripts/database-backup-wrapper-contract');
const credentials = {
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  refreshToken: 'synthetic-refresh',
};
const granted = (override = {}) =>
  Response.json({
    access_token: 'synthetic-access-1',
    token_type: 'Bearer',
    scope: DRIVE_FILE_SCOPE,
    expires_in: 3600,
    ...override,
  });
test('production design is inert; duplicate/ambiguous uploads never retry creation or delete', () => {
  const design = productionWrapperDesign();
  assert.equal(design.status, 'disabled');
  assert.equal(design.productionDatabaseConfigured, false);
  assert.equal(design.oauthConfigured, false);
  assert.equal(design.receiptTrustConfigured, false);
  assert.equal(design.scheduleConfigured, false);
  assert.equal(design.notificationsConfigured, false);
  assert.equal(design.deletionEnabled, false);
  assert.equal(reconcileUpload({ matches: 0 }).action, 'create-once');
  assert.equal(
    reconcileUpload({ matches: 0, ambiguousOutcome: true }).action,
    'inspect-session-and-orphans',
  );
  assert.equal(reconcileUpload({ matches: 1 }).action, 'verify-existing-ciphertext-readback');
  assert.equal(reconcileUpload({ matches: 2 }).action, 'manual-duplicate-review');
  for (const matches of [0, 1, 2])
    assert.equal(reconcileUpload({ matches, ambiguousOutcome: true }).success, false);
  assert.equal(reconcileUpload({ matches: 2 }).delete, false);
});
test('only repeatable stages and transient responses get bounded backoff within remaining budget', () => {
  assert.deepEqual(
    retryDecision({ stage: 'metadata-read', status: 503, attempt: 1, remainingMs: 120000 }),
    { retry: true, waitMs: 1000 },
  );
  assert.deepEqual(
    retryDecision({
      stage: 'readback',
      status: 429,
      attempt: 2,
      remainingMs: 120000,
      retryAfterMs: 4000,
    }),
    { retry: true, waitMs: 4000 },
  );
  for (const override of [
    { stage: 'upload-create' },
    { stage: 'export' },
    { status: 401 },
    { status: 403 },
    { status: 307 },
    { status: 400 },
    { attempt: 3 },
    { remainingMs: 30000 },
    { retryAfterMs: 6000 },
    { retryAfterMs: -1 },
  ])
    assert.equal(
      retryDecision({
        stage: 'owner-read',
        status: 503,
        attempt: 1,
        remainingMs: 120000,
        ...override,
      }).retry,
      false,
    );
});
test('scratch budgeting covers ciphertext plus readback and a reserve; invalid or insufficient inputs fail closed', () => {
  assert.deepEqual(
    scratchBudget({ availableBytes: 300, maxCiphertextBytes: 100, reserveBytes: 100 }),
    { status: 'sufficient', requiredBytes: 300 },
  );
  assert.equal(
    scratchBudget({ availableBytes: 299, maxCiphertextBytes: 100, reserveBytes: 100 }).status,
    'insufficient',
  );
  for (const maxCiphertextBytes of [0, -1, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() =>
      scratchBudget({ availableBytes: 300, maxCiphertextBytes, reserveBytes: 100 }),
    );
});
test('failure and missing-run observations use fixed stages and never claim delivered notifications or a restore', () => {
  assert.deepEqual(failureEvidence('timeout'), {
    status: 'failed',
    stage: 'timeout',
    databaseRecoveryVerified: false,
  });
  assert.throws(() => failureEvidence({ message: 'SYNTHETIC SECRET' }));
  assert.throws(() => failureEvidence('SYNTHETIC SECRET'));
  assert.equal(runObservation({}).status, 'disabled');
  assert.equal(runObservation({ enabled: true, deadlineAt: 100, now: 101 }).status, 'missing-run');
  assert.equal(runObservation({ enabled: true, deadlineAt: 100, now: 99 }).status, 'awaiting-run');
  assert.equal(
    runObservation({ enabled: true, deadlineAt: 100, now: 101, envelope: { status: 'verified' } })
      .status,
    'unverified',
  );
  assert.equal(
    runObservation({ enabled: true, deadlineAt: 100, now: 101 }).notificationDelivered,
    false,
  );
});
test('fixture OAuth caches, expires and explicitly refreshes a bounded drive.file token without reading real credentials', async () => {
  let clock = 0,
    calls = 0;
  const token = createFixtureOAuthAdapter({
    credentials,
    now: () => clock,
    request: async (url, options) => {
      calls++;
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      assert.equal(options.redirect, 'error');
      assert.equal(options.body.get('grant_type'), 'refresh_token');
      assert.equal(options.body.get('refresh_token'), 'synthetic-refresh');
      return granted({ access_token: `synthetic-access-${calls}` });
    },
  });
  assert.equal(await token(), 'synthetic-access-1');
  assert.equal(await token(), 'synthetic-access-1');
  assert.equal(calls, 1);
  clock = 3600000;
  assert.equal(await token(), 'synthetic-access-2');
  assert.equal(await token({ forceRefresh: true }), 'synthetic-access-3');
  assert.throws(() =>
    createFixtureOAuthAdapter({
      credentials: { ...credentials, clientSecret: 'real-like-credential' },
      request: async () => granted(),
    }),
  );
  assert.throws(() => createFixtureOAuthAdapter({ credentials }));
});
test('fixture OAuth transient failures back off at most twice; authorization/redirect failures do not retry', async () => {
  let calls = 0,
    clock = 0;
  const waits = [];
  const token = createFixtureOAuthAdapter({
    credentials,
    now: () => clock,
    wait: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    request: async () => (++calls < 3 ? new Response(null, { status: 503 }) : granted()),
  });
  assert.equal(await token(), 'synthetic-access-1');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 3000]);
  for (const status of [400, 401, 403, 307]) {
    let attempts = 0;
    const rejected = createFixtureOAuthAdapter({
      credentials,
      request: async () => {
        attempts++;
        return new Response(null, { status });
      },
    });
    await assert.rejects(rejected());
    assert.equal(attempts, 1);
  }
  let attempts = 0;
  const exhausted = createFixtureOAuthAdapter({
    credentials,
    wait: async () => {},
    request: async () => {
      attempts++;
      return new Response(null, { status: 503 });
    },
  });
  await assert.rejects(exhausted());
  assert.equal(attempts, 3);
  const malformed = createFixtureOAuthAdapter({
    credentials,
    request: async () => new Response(null, { status: 429, headers: { 'retry-after': '100' } }),
  });
  await assert.rejects(malformed());
});
test('fixture OAuth rejects cancelled, redirected, overly scoped, expired or rotated credentials', async () => {
  for (const response of [
    () => granted({ scope: 'https://www.googleapis.com/auth/drive' }),
    () => granted({ expires_in: 0 }),
    () => granted({ access_token: 'not-synthetic' }),
    () => granted({ refresh_token: 'SYNTHETIC ROTATION NOT APPROVED' }),
  ]) {
    const token = createFixtureOAuthAdapter({ credentials, request: async () => response() });
    await assert.rejects(token());
  }
  const redirect = createFixtureOAuthAdapter({
    credentials,
    request: async () => {
      throw new TypeError('redirect forbidden');
    },
  });
  await assert.rejects(redirect());
  const abort = new AbortController();
  abort.abort();
  let called = false;
  const token = createFixtureOAuthAdapter({
    credentials,
    request: async () => {
      called = true;
      return granted();
    },
  });
  await assert.rejects(token({ signal: abort.signal }));
  assert.equal(called, false);
});
