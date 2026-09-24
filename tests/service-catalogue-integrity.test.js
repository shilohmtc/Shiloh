const assert = require('node:assert/strict');
const test = require('node:test');
const {
  catalogueIssues,
  projectBookingEligibility,
} = require('../src/services/workspaceServices');

test('active service without a category is flagged and cannot be eligible', () => {
  const service = {
    id: 1,
    name: 'Uncategorised treatment',
    status: 'active',
    category_name: null,
    variable_price: false,
    price: '250.00',
  };
  const issues = catalogueIssues(service);
  assert.deepEqual(issues.map(issue => issue.code), ['missing_category']);
  const eligibility = projectBookingEligibility(service, [
    { status: 'active', client_bookable: true },
  ]);
  assert.equal(eligibility.categoryConfigured, false);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.catalogueIssues.some(issue => issue.code === 'missing_category'));
});

test('active service with a category and fixed price can pass catalogue checks', () => {
  const service = {
    id: 2,
    name: 'Toe Gel Only',
    status: 'active',
    category_name: 'Nail care',
    variable_price: false,
    price: '250.00',
  };
  assert.deepEqual(catalogueIssues(service), []);
  assert.equal(projectBookingEligibility(service, [
    { status: 'active', client_bookable: true },
  ]).eligible, true);
});

test('inactive historical services are preserved without an active catalogue warning', () => {
  const service = {
    id: 3,
    name: 'Legacy service',
    status: 'inactive',
    category_name: null,
    variable_price: false,
    price: null,
  };
  assert.deepEqual(catalogueIssues(service), []);
});
