// Loaded by Node in the trial only. Playwright sets this for child test workers.
const fs = require('node:fs');
const path = require('node:path');
if (process.env.TEST_WORKER_INDEX !== undefined && process.env.SHILOH_TRIAL_ROOT) {
  const root = path.join(process.env.SHILOH_TRIAL_ROOT, 'workers', process.env.TEST_PARALLEL_INDEX || '0');
  if (!fs.existsSync(path.join(root, 'package.json'))) throw new Error('Missing isolated trial checkout');
  process.chdir(root);
  process.env.TMPDIR = path.join(root, '.trial-tmp');
}
