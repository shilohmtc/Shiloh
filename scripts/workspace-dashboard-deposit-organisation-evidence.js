const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { dashboardDepositsHtml } = require('../stories/fixtures/workspaceDashboardDeposits');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts/dashboard-deposit-organisation');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const base = process.env.REVIEW_BASE_SHA || git('merge-base', 'HEAD', 'origin/main');
function baseline(file, dependencies = {}) {
  const filename = path.join(root, file), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const requireOriginal = mod.require.bind(mod);
  mod.require = name => dependencies[Module._resolveFilename(name, mod)] || requireOriginal(name);
  mod._compile(git('show', `${base}:${file}`), filename);
  return mod.exports;
}
async function main() {
  const head = git('rev-parse', 'HEAD'), dirty = Boolean(git('status', '--porcelain', '--untracked-files=no'));
  if (process.env.EVIDENCE_EXPECTED_HEAD && (head !== process.env.EVIDENCE_EXPECTED_HEAD || dirty)) throw Error('Exact clean source required');
  const shell = baseline('src/presentation/workspaceShell.js');
  const completion = baseline('src/presentation/planningRequestCompletionUx.js');
  const dashboard = baseline('src/presentation/workspaceDashboardUx.js', { [path.join(root, 'src/presentation/workspaceShell.js')]: shell, [path.join(root, 'src/presentation/planningRequestCompletionUx.js')]: completion });
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}), args: ['--no-sandbox'] });
  const records = [];
  try {
    const page = await browser.newPage({ locale: 'en-ZA', timezoneId: 'Africa/Johannesburg', reducedMotion: 'reduce' });
    await page.route('**/calendar/workspace/navigation', route => route.fulfill({ json: {} }));
    await page.route('**/calendar/pwa/icon-192.png*', route => route.fulfill({ path: path.join(root, 'public/assets/pwa/shiloh-pwa-192.png') }));
    for (const kind of ['sparse', 'busy']) for (const width of [1180, 1440, 390, 500]) for (const stage of ['before', 'after']) {
      const html = dashboardDepositsHtml(kind, stage === 'before' ? dashboard.renderDashboardPage : undefined);
      const renderedHtml = `${stage}-${kind}.html`, filename = `${stage}-${kind}-${width}.png`;
      const viewport = { width, height: 757 }; await page.setViewportSize(viewport);
      await page.route('**/review-layout', route => route.fulfill({ contentType: 'text/html', body: html }));
      await page.goto('http://127.0.0.1:6006/review-layout', { waitUntil: 'networkidle' });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
      const metrics = await page.evaluate(() => {
        const box = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } : null; };
        const deposits = box('[data-dashboard-deposits]');
        const today = box('[data-dashboard-today]'), attention = box('[data-dashboard-attention-panel]'), carryover = box('[data-dashboard-carryover-panel]'), activity = box('[data-dashboard-activity-panel]');
        const firstAction = box('[data-dashboard-attention-panel] button:not([disabled]),[data-dashboard-attention-panel] a');
        return { today, deposits, depositAccounts: document.querySelectorAll('[data-deposit-account]').length, repeatedAttentionAppointments: document.querySelectorAll('[data-dashboard-attention-appointment]').length, attentionBadge:document.querySelector('[data-dashboard-attention-panel]>.panel-head .summary-pill')?.textContent, attention, carryover, activity, firstAction, documentHeight: document.documentElement.scrollHeight,
          horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
          attentionScroll: Math.max(0, attention.y - 100), firstActionScroll: Math.max(0, firstAction.bottom - innerHeight),
          unrelatedRowGap: Math.max(0, attention.y - carryover.bottom),
          controls: [...document.querySelectorAll('.appointment-actions button,.appointment-actions a')].map(n => ({ text: n.textContent.trim(), height: n.getBoundingClientRect().height, fontSize: getComputedStyle(n).fontSize })),
          sidebar: ['vouchers', 'rewards'].map(key => { const n = document.querySelector(`[data-workspace-destination="${key}"]`); const style = getComputedStyle(n, '::before'); return { key, label: n.textContent.trim(), display: style.display, mask: style.maskImage, width: style.width }; }),
        };
      });
      fs.writeFileSync(path.join(output, renderedHtml), html);
      await page.screenshot({ path: path.join(output, filename), fullPage: true });
      records.push({ kind, stage, viewport, filename, sha256: hash(fs.readFileSync(path.join(output, filename))), renderedHtml, renderedHtmlSha256: hash(html), metrics });
      await page.unroute('**/review-layout');
    }
    const files = git('diff', '--no-renames', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
    const deletedSourceFiles = files.filter(file => !fs.existsSync(path.join(root, file)));
    const manifest = { sourceHead: head, sourceTree: git('rev-parse', 'HEAD^{tree}'), baseCommit: base, dirty,
      browser: await browser.version(), fontProfileSha256: process.env.FONTCONFIG_FILE ? hash(fs.readFileSync(process.env.FONTCONFIG_FILE)) : null,
      brandAssetSha256: hash(fs.readFileSync(path.join(root, 'public/assets/pwa/shiloh-pwa-192.png'))),
      patchSha256: hash(execFileSync('git', ['diff', '--no-renames', base, 'HEAD'], { cwd: root, maxBuffer: 16 * 1024 * 1024 })),
      sourceFiles: files.filter(file => !deletedSourceFiles.includes(file)).map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
      deletedSourceFiles,
      provenance: 'Identical fabricated models, Chromium, font profile and original brand asset. Before Dashboard AND shell compiled from recorded base. After uses current production presenters. Exact-source acceptance requires clean expected head. No live client data, authenticated live UI or physical devices. Discovery dirty packets are not final-head acceptance; repeat after source freeze.', records };
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log('Synthetic comparable deposit Dashboard evidence and layout metrics captured.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
