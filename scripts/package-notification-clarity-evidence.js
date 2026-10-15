'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'artifacts/notification-clarity');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const sourceHead = git('rev-parse', 'HEAD'), sourceTree = git('rev-parse', 'HEAD^{tree}');
if (git('status', '--porcelain', '--untracked-files=no')) throw Error('Evidence requires clean source');
if (process.env.EVIDENCE_EXPECTED_HEAD && process.env.EVIDENCE_EXPECTED_HEAD !== sourceHead) throw Error('Evidence head mismatch');
const base = process.env.REVIEW_BASE_SHA || git('merge-base', 'HEAD', 'origin/main');
const files = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
const records = [];
for (const width of [390, 500, 1180, 1440]) for (const story of ['all', 'recent', 'attention', 'profile-unknown', 'profile-used', 'profile-setup-needed']) {
  for (const extension of ['png', 'html']) {
    const filename = `${story}-${width}.${extension}`;
    const bytes = fs.readFileSync(path.join(output, filename));
    records.push({ filename, sha256: hash(bytes), bytes: bytes.length });
  }
}
const patch = execFileSync('git', ['diff', '--binary', base, 'HEAD'], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(path.join(output, 'source.patch'), patch);
const manifest = { sourceHead, sourceTree, base, patchSha256: hash(patch),
  sourceFiles: files.map(file => ({ file, sha256: fs.existsSync(path.join(root, file)) ? hash(fs.readFileSync(path.join(root, file))) : null })),
  brandSha256: hash(fs.readFileSync(path.join(root, 'public/assets/pwa/shiloh-pwa-192.png'))),
  fontProfileSha256: process.env.FONTCONFIG_FILE ? hash(fs.readFileSync(process.env.FONTCONFIG_FILE)) : null,
  records, provenance: 'Synthetic Storybook browser checks only. No authenticated live UI, physical device, delivery or reading proof.' };
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Notification clarity screenshots and HTML bound to clean source, full binary diff and brand hash.');
