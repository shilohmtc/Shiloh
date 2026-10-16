const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { appRelease } = require('../src/presentation/appRelease');
const { workspacePwaServiceWorkerScript } = require('../src/presentation/workspacePwa');
test('app release uses a bounded public build and rejects arbitrary environment text', () => {
  assert.equal(appRelease({ RENDER_GIT_COMMIT: 'a'.repeat(40) }), '2.1.0-aaaaaaa');
  assert.equal(appRelease({ RENDER_GIT_COMMIT: 'b'.repeat(40) }), '2.1.0-bbbbbbb');
  assert.equal(appRelease({ RENDER_GIT_COMMIT: '</script>secret' }), '2.1.0-local');
  assert.match(workspacePwaServiceWorkerScript(), /const APP_RELEASE="2\.1\.0-/);
});
test('new client builds get distinct caches while preserving Workspace and unrelated caches', async () => {
  const worker = fs.readFileSync('public/my-shiloh/sw.js', 'utf8');
  for (const version of ['2.1.0-aaaaaaa', '2.1.0-bbbbbbb']) {
    const handlers = new Map(), opened = [], deleted = [];
    const self = { SHILOH_APP_RELEASE: version, addEventListener: (event, handler) => handlers.set(event, handler), clients: { claim: async () => {} } };
    vm.runInNewContext(worker, { self, caches: { open: async key => { opened.push(key); return { addAll: async urls => { assert.ok(urls.includes(`/my-shiloh/assets/app.js?v=${version}`)); } }; }, keys: async () => [`my-shiloh-shell-v64-${version}`, `my-shiloh-static-v64-${version}`, 'my-shiloh-shell-v64-old', 'shiloh-pwa-static-official-brand-v2', 'another-app'], delete: async key => deleted.push(key) } });
    let pending;
    handlers.get('install')({ waitUntil: promise => { pending = promise; } }); await pending;
    assert.deepEqual(opened, [`my-shiloh-shell-v64-${version}`]);
    handlers.get('activate')({ waitUntil: promise => { pending = promise; } }); await pending;
    assert.deepEqual(deleted, ['my-shiloh-shell-v64-old']);
  }
});
test('served client worker is executable JavaScript with the same release as its HTML assets', async t => {
  const express = require('express');
  const { createMyShilohRouter } = require('../src/routes/myShiloh');
  const app = express(); app.use(createMyShilohRouter({ env: { NODE_ENV: 'test' } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/my-shiloh/sw.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('service-worker-allowed'), '/my-shiloh/');
  const source = await response.text();
  const self = { addEventListener() {} };
  vm.runInNewContext(source, { self });
  assert.equal(self.SHILOH_APP_RELEASE, appRelease());
  assert.ok(require('../src/presentation/myShilohPwa').renderMyShilohPage().includes(`app.js?v=${appRelease()}`));
});
