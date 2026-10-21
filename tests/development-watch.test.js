'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const pkg = require('../package.json');

async function fixture(t, { failPreflight = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shiloh-watch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: pkg.scripts.dev } }));
  const preloads = [...pkg.scripts.dev.matchAll(/ -r (\S+)/g)].map(match => match[1]);
  for (const file of preloads) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), `global.syntheticPreloads = [...(global.syntheticPreloads || []), ${JSON.stringify(file)}];`);
  }
  await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(dir, 'scripts/verify-migrations.js'), failPreflight ? 'process.exit(7);'
    : "require('node:fs').appendFileSync('preflight.txt', 'checked\\n');");
  await fs.writeFile(path.join(dir, 'value.js'), "module.exports = 'initial';");
  await fs.writeFile(path.join(dir, 'app.js'), "console.log(JSON.stringify({value:require('./value'),preloads:global.syntheticPreloads})); setInterval(() => {}, 1000);");
  const child = spawn('npm', ['run', 'dev', '--silent'], { cwd: dir, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { errors += data; });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const done = once(child, 'exit');
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
    await done;
  });
  const records = () => output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const waitFor = async predicate => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (predicate(records())) return;
      assert.equal(child.exitCode, null, `watcher exited: ${errors}`);
      await delay(50);
    }
    assert.fail(`watcher did not produce expected restart: ${output}\n${errors}`);
  };
  return { dir, child, preloads, records, waitFor };
}

test('native development watch keeps preloads and restarts on imported module and preload changes', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  await f.waitFor(rows => rows.length === 1);
  assert.deepEqual(f.records()[0].preloads, f.preloads);
  await fs.writeFile(path.join(f.dir, 'value.js'), "module.exports = 'updated';");
  await f.waitFor(rows => rows.some(row => row.value === 'updated'));
  const before = f.records().length;
  await fs.appendFile(path.join(f.dir, f.preloads[0]), "global.syntheticPreloads.push('changed-preload');");
  await f.waitFor(rows => rows.length > before && rows.at(-1).preloads.includes('changed-preload'));
  assert.equal(await fs.readFile(path.join(f.dir, 'preflight.txt'), 'utf8'), 'checked\n');
});

test('a failed migration preflight prevents development application startup', { timeout: 15000 }, async t => {
  const f = await fixture(t, { failPreflight: true });
  const [code] = await once(f.child, 'exit');
  assert.equal(code, 7);
  assert.deepEqual(f.records(), []);
  await assert.rejects(fs.stat(path.join(f.dir, 'preflight.txt')), { code: 'ENOENT' });
});
