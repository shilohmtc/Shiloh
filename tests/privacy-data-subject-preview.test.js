const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getClientPrivacyInventory,
  validClientId,
  quoteIdentifier,
  classifyDirectReference,
} = require('../src/services/privacyClientInventory');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('privacy preview primitives fail closed', () => {
  assert.equal(validClientId('123'), true);
  assert.equal(validClientId('0'), false);
  assert.equal(validClientId('1 OR 1=1'), false);
  assert.equal(quoteIdentifier('appointments'), '"appointments"');
  assert.throws(() => quoteIdentifier('appointments; DELETE FROM clients'));
  assert.equal(classifyDirectReference('appointments'), 'retain_pending_policy');
  assert.equal(classifyDirectReference('client_contacts'), 'erase_or_deidentify_candidate');
  assert.equal(classifyDirectReference('future_sensitive_table'), 'manual_review_required');
});

test('privacy inventory is preserved but the legacy shared-key HTTP route is retired', () => {
  const route = source('src/routes/admin.js');
  const app = source('app.js');
  const service = source('src/services/privacyClientInventory.js');

  assert.match(route, /SHILOH_LEGACY_ADMIN_API_RETIRED/);
  assert.match(route, /status\(410\)/);
  assert.doesNotMatch(app, /privacyRoutes|\/admin\/privacy/);
  assert.match(service, /destructiveActionAllowed:\s*false/);
  assert.doesNotMatch(service, /\b(?:DELETE\s+FROM|UPDATE\s+clients|INSERT\s+INTO\s+clients)\b/i);
});

test('synthetic privacy inventory counts linked records without returning contact values', async () => {
  const queries = [];
  const fakeDb = {
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ text, params });
      if (/FROM clients\s+WHERE id = \$1/.test(text)) {
        return { rows: [{ id: 42, status: 'active', source: 'synthetic', created_at: '2026-01-01', updated_at: '2026-08-01' }] };
      }
      if (text.includes('information_schema.table_constraints')) {
        return { rows: [
          { table_schema: 'public', table_name: 'appointments', column_name: 'client_id' },
          { table_schema: 'public', table_name: 'client_contacts', column_name: 'client_id' },
          { table_schema: 'public', table_name: 'future_sensitive_table', column_name: 'client_id' },
        ] };
      }
      if (text.includes('FROM "appointments"')) return { rows: [{ count: 2 }] };
      if (text.includes('FROM "client_contacts"')) return { rows: [{ count: 1 }] };
      if (text.includes('FROM "future_sensitive_table"')) return { rows: [{ count: 3 }] };
      if (/SELECT DISTINCT normalized_value/.test(text)) return { rows: [{ normalized_value: '27820000000' }] };
      if (/SELECT to_regclass/.test(text)) {
        const name = params[0];
        return { rows: [{ table_name: name === 'public.booking_intents' ? null : name }] };
      }
      if (text.includes('FROM "user_profiles"')) return { rows: [{ count: 1 }] };
      if (text.includes('FROM "conversation_sessions"')) return { rows: [{ count: 1 }] };
      if (text.includes('FROM "client_onboarding_sessions"')) return { rows: [{ count: 0 }] };
      if (text.includes('FROM crm_audit_events')) return { rows: [{ count: 1 }] };
      throw new Error(`Unexpected synthetic query: ${text}`);
    },
  };

  const inventory = await getClientPrivacyInventory(42, fakeDb);
  assert.equal(inventory.status, 'ok');
  assert.equal(inventory.destructiveActionAllowed, false);
  assert.equal(inventory.summary.hasAppointmentHistory, true);
  assert.equal(inventory.proposedAction, 'deidentify_after_retention_review');
  assert.equal(inventory.directReferences.find((item) => item.table === 'future_sensitive_table').classification, 'manual_review_required');
  assert.equal(inventory.phoneLinked.some((item) => item.table === 'conversation_sessions'), true);
  assert.equal(JSON.stringify(inventory).includes('27820000000'), false);
  assert.equal(queries.some(({ text }) => /DELETE\s+FROM|UPDATE\s+clients|INSERT\s+INTO\s+clients/i.test(text)), false);
});
