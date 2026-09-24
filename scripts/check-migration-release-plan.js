#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');

function migrationFilesFromGit({ baseRef = process.env.SHILOH_BASE_REF, headRef = process.env.GITHUB_SHA } = {}) {
  const apiFiles = process.env.SHILOH_MIGRATION_FILES;
  if (apiFiles !== undefined) {
    return apiFiles.split(/\r?\n/).map(value => value.trim())
      .filter(value => /^migrations\/\d+_[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/.test(value))
      .map(value => value.slice('migrations/'.length));
  }
  if (!baseRef || !headRef) return [];
  const diff = execFileSync('git', [
    'diff', '--name-only', '--diff-filter=AM', `${baseRef}...${headRef}`, '--', 'migrations',
  ], { encoding: 'utf8' });
  return diff.split(/\r?\n/).map(value => value.trim())
    .filter(value => /^migrations\/\d+_[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/.test(value))
    .map(value => value.slice('migrations/'.length));
}

function validateMigrationReleasePlan({ migrationFiles, pullRequestBody = '' }) {
  const files = [...new Set((migrationFiles || []).filter(Boolean))].sort();
  if (files.length === 0) return { required: false, migrationFiles: [], requestedFilename: null };

  if (files.length !== 1) {
    throw new Error(
      `Production migration release gate blocked: exactly one migration may be released at a time; found ${files.join(', ')}.`,
    );
  }

  const requestedFilename = files[0];
  const marker = `SHILOH_CONTROLLED_RELEASE_MIGRATION=${requestedFilename}`;
  if (!String(pullRequestBody).includes(marker)) {
    throw new Error(
      `Production migration release gate blocked: PR body must declare \`${marker}\` before this migration can merge.`,
    );
  }

  return { required: true, migrationFiles: files, requestedFilename };
}

if (require.main === module) {
  const result = validateMigrationReleasePlan({
    migrationFiles: migrationFilesFromGit(),
    pullRequestBody: process.env.SHILOH_PULL_REQUEST_BODY || '',
  });
  console.log(JSON.stringify({
    event: 'production_migration_release_plan_verified',
    ...result,
    executor: 'npm run db:migrate',
    startupGuard: 'scripts/verify-migrations.js',
  }));
}

module.exports = { migrationFilesFromGit, validateMigrationReleasePlan };
