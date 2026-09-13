const test = require('node:test');
const assert = require('node:assert/strict');

const { workspacePwaClientScript } = require('../src/presentation/workspacePwa');

test('#794 iPhone browser install guidance is explicit and disappears in standalone mode', () => {
  const client = workspacePwaClientScript();

  assert.match(client, /iPhone\|iPad\|iPod/);
  assert.match(client, /navigator\.platform==='MacIntel'/);
  assert.match(client, /maxTouchPoints/);
  assert.match(client, /data-shiloh-ios-install/);
  assert.match(client, /Keep Shiloh close/);
  assert.match(client, /Tap Share/);
  assert.match(client, /Choose Add to Home Screen/);
  assert.match(client, /iosDevice\(\)&&!standalone\(\)/);
  assert.match(client, /display-mode: standalone/);
  assert.match(client, /navigator\.standalone===true/);
});

test('#794 iPhone install guidance stores only a tab-scoped presentation dismissal, never auth authority', () => {
  const client = workspacePwaClientScript();

  assert.match(client, /sessionStorage\.setItem\(INSTALL_DISMISS_KEY,'1'\)/);
  assert.match(client, /INSTALL_DISMISS_KEY='shiloh-ios-install-dismissed-v1'/);
  assert.doesNotMatch(client, /localStorage|indexedDB|document\.cookie/i);
  assert.doesNotMatch(client, /PushManager|showNotification/i);
  assert.match(client, /addEventListener\('beforeinstallprompt',event=>\{if\(!androidDevice\(\)\|\|standalone\(\)\)return;/);
  assert.doesNotMatch(client, /INSERT INTO|UPDATE\s+staff_|DELETE FROM|Authorization|Bearer\s/i);
});
