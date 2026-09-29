const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('service content migration is presentation-only', () => {
  const sql = fs.readFileSync('migrations/038_service_customer_content.sql', 'utf8');
  assert.match(sql, /customer_description/);
  assert.match(sql, /image_url/);
  assert.match(sql, /booking_note/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+(appointments|clients)/i);
  assert.doesNotMatch(sql, /UPDATE\s+(appointments|clients)/i);
});

test('public catalogue is active CRM only, mounted, and linked to My Shiloh booking', () => {
  const service = fs.readFileSync('src/services/serviceCatalogue.js', 'utf8');
  const route = fs.readFileSync('src/routes/services.js', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  assert.match(service, /s\.status = 'active'/);
  assert.match(route, /Continue in My Shiloh/);
  assert.match(route, /\/book\?service=/);
  assert.doesNotMatch(route, /wa\.me|Book via WhatsApp/);
  assert.match(app, /serviceRoutes/);
});

test('AI active catalogue includes customer-facing descriptions and booking notes', () => {
  const source = fs.readFileSync('src/services/activeCatalogueKnowledge.js', 'utf8');
  assert.match(source, /customer_description/);
  assert.match(source, /booking_note/);
});
