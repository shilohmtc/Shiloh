const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMigrationReleasePlan } = require('../scripts/check-migration-release-plan');

test('migration release gate is inert when a PR has no SQL migration', () => {
  assert.deepEqual(validateMigrationReleasePlan({ migrationFiles: [], pullRequestBody: '' }), {
    required: false,
    migrationFiles: [],
    requestedFilename: null,
  });
});

test('migration release gate requires the exact controlled filename', () => {
  assert.throws(
    () => validateMigrationReleasePlan({
      migrationFiles: ['153_toe_gel_price_and_bookability.sql'],
      pullRequestBody: 'This PR changes production data.',
    }),
    /SHILOH_CONTROLLED_RELEASE_MIGRATION=153_toe_gel_price_and_bookability\.sql/,
  );

  assert.deepEqual(validateMigrationReleasePlan({
    migrationFiles: ['153_toe_gel_price_and_bookability.sql'],
    pullRequestBody: 'SHILOH_CONTROLLED_RELEASE_MIGRATION=153_toe_gel_price_and_bookability.sql',
  }), {
    required: true,
    migrationFiles: ['153_toe_gel_price_and_bookability.sql'],
    requestedFilename: '153_toe_gel_price_and_bookability.sql',
  });
});

test('migration release gate rejects multiple SQL migrations in one release', () => {
  assert.throws(
    () => validateMigrationReleasePlan({
      migrationFiles: ['153_one.sql', '154_two.sql'],
      pullRequestBody: 'SHILOH_CONTROLLED_RELEASE_MIGRATION=153_one.sql',
    }),
    /exactly one migration may be released at a time/,
  );
});
