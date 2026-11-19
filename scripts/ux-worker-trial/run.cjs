const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const root = process.cwd();
const output = path.join(root, 'artifacts/worker-trial');
fs.mkdirSync(output, { recursive: true });
const smoke = process.env.SHILOH_TRIAL_SMOKE === '1';
const order = smoke ? [1, 2] : [1, 2, 2, 1, 1, 2];
const summary = [];
for (const [index, workers] of order.entries()) {
  const run = path.join(output, `run-${index + 1}-workers-${workers}`);
  fs.mkdirSync(run, { recursive: true });
  for (let worker = 0; worker < workers; worker++) {
    const copy = path.join(run, 'workers', String(worker));
    if (spawnSync('git', ['clone', '--shared', '--no-checkout', root, copy]).status !== 0) throw new Error('Isolated source clone failed');
    // Excludes generated output and dependency trees; all test inputs are copied.
    const copied = spawnSync('tar', ['--exclude=./.git', '--exclude=./node_modules', '--exclude=./artifacts', '-cf', path.join(run, 'inputs.tar'), '.'], { cwd: root });
    if (copied.status !== 0) throw new Error('Input copy failed');
    if (spawnSync('tar', ['-xf', path.join(run, 'inputs.tar'), '-C', copy]).status !== 0) throw new Error('Input extraction failed');
    if (spawnSync('git', ['reset', '--mixed', 'HEAD'], { cwd: copy }).status !== 0) throw new Error('Isolated index failed');
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(copy, 'node_modules'));
    fs.mkdirSync(path.join(copy, '.trial-tmp'));
  }
  fs.rmSync(path.join(run, 'inputs.tar'));
  const env = { ...process.env, SHILOH_TRIAL_ROOT: run, NODE_OPTIONS: `--require=${path.join(root, 'scripts/ux-worker-trial/worker-cwd.cjs')}`, PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(run, 'results.json') };
  delete env.DATABASE_URL; delete env.BASELINE_SOURCE_DATABASE_URL;
  const args = ['test', '--config=playwright.ux.config.js', `--workers=${workers}`, '--reporter=line,json', `--output=${path.join(run, 'playwright')}`];
  if (smoke) args.push('tests/workspace-client-gender.spec.js', 'tests/booking-deposit-waiver-client-payment.spec.js');
  const listed = spawnSync(path.join(root, 'node_modules/.bin/playwright'), [...args, '--list'], { env, encoding: 'utf8' });
  fs.writeFileSync(path.join(run, 'test-list.txt'), listed.stdout + listed.stderr);
  fs.rmSync(path.join(run, 'results.json'), { force: true });
  const log = fs.openSync(path.join(run, 'run.log'), 'w');
  const start = Date.now();
  const result = spawnSync('python3', [path.join(root, 'scripts/ux-worker-trial/measure.py'), path.join(run, 'resources.json'), path.join(root, 'node_modules/.bin/playwright'), ...args], { env, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  const report = fs.existsSync(path.join(run, 'results.json')) ? JSON.parse(fs.readFileSync(path.join(run, 'results.json'))) : null;
  summary.push({ run: index + 1, workers, elapsedMs: Date.now() - start, exitCode: result.status, stats: report?.stats, cpuCount: os.cpus().length, totalMemory: os.totalmem(), source: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() });
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  // Preserve worker screenshots/logs, remove only copied test inputs after each run.
  for (let worker = 0; worker < workers; worker++) {
    const copy = path.join(run, 'workers', String(worker));
    for (const entry of fs.readdirSync(copy)) if (entry !== 'artifacts') fs.rmSync(path.join(copy, entry), { recursive: true, force: true });
  }
}
if (summary.some(run => run.exitCode !== 0)) process.exitCode = 1;
