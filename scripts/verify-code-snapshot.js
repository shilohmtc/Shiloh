#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function verifyBundle(bundle, commit) {
  git(['bundle', 'verify', bundle]);
  const heads = git(['bundle', 'list-heads', bundle])
    .split('\n')
    .map((line) => line.split(' '));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-restore-'));
  try {
    git(['init', '--bare', temp]);
    git(['fetch', bundle, '+refs/*:refs/*'], temp);
    git(['fsck', '--full', '--strict'], temp);
    for (const [sha, ref] of heads.filter(([, ref]) => ref.startsWith('refs/'))) {
      if (git(['rev-parse', ref], temp) !== sha) throw new Error('Restored reference mismatch');
    }
    git(['cat-file', '-e', `${commit}^{commit}`], temp);
    return heads.filter(([, ref]) => ref.startsWith('refs/')).length;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function main() {
  if (git(['rev-parse', '--is-shallow-repository']) !== 'false')
    throw new Error('Full history is required');
  const dir = path.resolve('artifacts/system-maintenance');
  fs.mkdirSync(dir, { recursive: true });
  const commit = git(['rev-parse', 'HEAD']);
  const bundle = path.join(
    dir,
    `shiloh-${new Date().toISOString().slice(0, 10)}-${commit.slice(0, 12)}.bundle`,
  );
  git(['bundle', 'create', bundle, '--all']);
  const refsVerified = verifyBundle(bundle, commit);
  const manifest = {
    status: 'restore-verified-github-checkpoint',
    checkedAt: new Date().toISOString(),
    commit,
    file: path.basename(bundle),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex'),
    refsVerified,
    restoreVerified: true,
    independentBackup: false,
    scope:
      'Fetched Git history and refs only; excludes GitHub metadata, LFS objects, database, uploads and secrets',
  };
  fs.writeFileSync(path.join(dir, 'code-snapshot.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

module.exports = { verifyBundle, main };
if (require.main === module) {
  try {
    main();
  } catch {
    console.error('Code checkpoint failed; recovery is unverified.');
    process.exitCode = 1;
  }
}
