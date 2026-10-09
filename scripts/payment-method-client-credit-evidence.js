'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const directory = 'artifacts/payment-method-client-credit';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}');
if (process.env.EVIDENCE_EXPECTED_HEAD && head !== process.env.EVIDENCE_EXPECTED_HEAD) throw new Error('Evidence does not match the exact PR head.');
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Evidence requires a clean committed source tree.');
const states = ['card-machine', 'voucher', 'partial-client-credit', 'active-request', 'client-credit-section', 'view-only-credit-section', 'credit-unavailable', 'credit-500-preview', 'mixed-payment-settled', 'manual-retry', 'voucher-retry'];
const files = ['desktop', 'phone', 'narrow'].flatMap(viewport => states.map(state => {
  const file = `${viewport}-${state}.png`, bytes = fs.readFileSync(path.join(directory, file));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG ${file}`);
  return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}));
const manifest = { source: { commit: head, tree }, provenance: process.env.EVIDENCE_PROVENANCE || 'local-synthetic-installed-chrome', syntheticOnly: true, productionRenderers: true, fullResolution: true, runId: process.env.GITHUB_RUN_ID || null, files };
fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ head, tree, files: files.length }));
