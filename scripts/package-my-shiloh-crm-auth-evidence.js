'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const source = path.resolve(
  process.env.CRM_AUTH_EVIDENCE_SOURCE || 'artifacts/ux-playwright-results',
);
const destination = path.resolve('artifacts/my-shiloh-crm-auth-review');
function filesIn(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((item) =>
      item.isDirectory() ? filesIn(path.join(dir, item.name)) : [path.join(dir, item.name)],
    );
}
const files = filesIn(source);
const expected = ['phone', 'desktop'].flatMap((device) =>
  ['entry', 'generic-error', 'registration', 'protected-settings'].map(
    (state) => `crm-${state}-${device}.png`,
  ),
);
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
const screenshots = expected.map((name) => {
  const matches = files.filter((file) => path.basename(file) === name);
  if (matches.length !== 1) throw new Error(`Expected one CRM auth screenshot: ${name}`);
  const bytes = fs.readFileSync(matches[0]);
  fs.writeFileSync(path.join(destination, name), bytes);
  return {
    name,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
});
const totalScreenshotBytes = screenshots.reduce((total, item) => total + item.bytes, 0);
if (totalScreenshotBytes > 8 * 1024 * 1024) throw new Error('CRM review package exceeds 8 MiB');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (process.env.EVIDENCE_EXPECTED_HEAD && head !== process.env.EVIDENCE_EXPECTED_HEAD)
  throw new Error('CRM evidence head mismatch');
const manifest = {
  head,
  tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  synthetic: true,
  binding:
    process.env.GITHUB_ACTIONS === 'true'
      ? 'Captured and packaged at exact CI head'
      : 'Packaging head only; local captures preceded the final commit; exact-head browser/CI review is pending privacy remediation',
  provenance:
    process.env.GITHUB_ACTIONS === 'true'
      ? 'github-actions-pinned-chromium'
      : 'local-pinned-chromium',
  stability:
    'Loaded fonts, visible anchor/ancestor opacity, centered failure message, disabled finite animations.',
  totalScreenshotBytes,
  screenshots,
};
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `Packaged ${screenshots.length} CRM screenshots (${totalScreenshotBytes} bytes) at ${head}`,
);
