'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const source = path.resolve(process.env.MY_SHILOH_SIGNIN_EVIDENCE_SOURCE || 'artifacts/ux-playwright-results');
const destination = path.resolve('artifacts/my-shiloh-signin-review');
const expected = ['details-narrow-enlarged.png'];
for (const device of ['phone', 'desktop']) {
  for (const state of ['crm-entry', 'crm-registration', 'crm-generic-error', 'crm-protected-settings', 'optional-passkey-not-now',
    'profile-confirmation-conflict', 'session-revocation-fresh-auth-required', 'session-revocation-result']) {
    expected.push(`${state}-${device}.png`);
  }
}

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(filename) : [filename];
  });
}

const files = filesIn(source);
const selected = expected.map(name => {
  const matches = files.filter(filename => path.basename(filename) === name);
  if (matches.length !== 1) throw new Error(`Expected exactly one focused screenshot: ${name}`);
  return { name, filename: matches[0], bytes: fs.statSync(matches[0]).size };
});
const totalBytes = selected.reduce((sum, file) => sum + file.bytes, 0);
// Leave ample room beneath the reviewer's 32 MiB download limit.
if (totalBytes > 8 * 1024 * 1024) throw new Error('Focused screenshot set exceeds 8 MiB');

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
const screenshots = selected.map(file => {
  const bytes = fs.readFileSync(file.filename);
  fs.writeFileSync(path.join(destination, file.name), bytes);
  return { name: file.name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
});
const manifest = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  synthetic: true,
  provenance: 'Production-backed Storybook, synthetic Playwright route fixtures; no real SMS or client writes. CI bytes when generated in GitHub Actions, local bytes otherwise.',
  stability: 'Visible anchor and ancestor opacity >= 0.99, loaded fonts and disabled finite animations before capture.',
  totalScreenshotBytes: totalBytes,
  screenshots,
};
fs.writeFileSync(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Packaged ${screenshots.length} focused screenshots (${totalBytes} bytes) for ${manifest.head}`);
