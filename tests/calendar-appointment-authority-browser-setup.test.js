const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/calendar-appointment-authority-v1-proof.yml'), 'utf8');
const setupStep = workflow.split('      - name: Verify installed Chrome for authority proof\n')[1]?.split('      - name:')[0];
assert.ok(setupStep, 'Authority browser setup step must exist');
const setupScript = setupStep.split('        run: |\n')[1].split('\n')
  .filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');

function fixture(t, version, executable = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-authority-browser-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const browser = path.join(directory, 'fixture-chrome');
  if (version !== null) fs.writeFileSync(browser, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: executable ? 0o755 : 0o644 });
  const environmentFile = path.join(directory, 'github-env');
  const result = spawnSync('bash', ['-c', setupScript], {
    cwd: directory,
    env: { ...process.env, CHROME_BIN: browser, GITHUB_ENV: environmentFile },
    encoding: 'utf8',
  });
  return { directory, browser, environmentFile, result };
}

test('authority setup records installed browser identity and passes that exact executable to the unchanged proof', t => {
  const { directory, browser, environmentFile, result } = fixture(t, 'Google Chrome 154.0.8037.97');
  assert.equal(result.status, 0, result.stderr);
  const record = fs.readFileSync(path.join(directory, 'artifacts/calendar-appointment-authority-v1/browser-environment.txt'), 'utf8');
  assert.equal(record, `Executable: ${browser}\nVersion: Google Chrome 154.0.8037.97\n`);
  assert.equal(fs.readFileSync(environmentFile, 'utf8'), `CHROME_BIN=${browser}\n`);
  assert.ok(result.stdout.includes(browser));
  assert.ok(result.stdout.includes('Google Chrome 154.0.8037.97'));
});

for (const [name, version, executable] of [
  ['missing', null, true],
  ['non-executable', 'Google Chrome 154.0.8037.97', false],
  ['unrecognized', 'Unrelated tool 1.0', true],
]) {
  test(`authority setup fails closed for a ${name} configured browser`, t => {
    const { environmentFile, result } = fixture(t, version, executable);
    assert.notEqual(result.status, 0);
    assert.ok(result.stdout.includes('::error::'), result.stdout);
    assert.equal(fs.existsSync(environmentFile), false, 'Failed setup must not configure a fallback browser');
  });
}
