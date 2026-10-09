'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const directory = 'artifacts/paid-booking-payment';
const files = fs.readdirSync(directory).filter(name => name.endsWith('.png') && !name.includes('-before-')).sort();
if (files.length !== 12) throw new Error(`Expected 12 synthetic payment screenshots, found ${files.length}`);
const manifest = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  evidence: 'Synthetic Storybook paid, remaining-balance and deposit views plus manual confirmation on desktop, phone and 320px. No real client transactions.',
  files: files.map(name => { const bytes = fs.readFileSync(path.join(directory, name)); return { name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; }),
};
fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
