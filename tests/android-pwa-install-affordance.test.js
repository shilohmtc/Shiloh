const test = require('node:test');
const assert = require('node:assert/strict');

const { workspacePwaClientScript } = require('../src/presentation/workspacePwa');

test('#810 Chromium install affordance is browser-owned, user-gesture driven, and non-authoritative', () => {
  const client = workspacePwaClientScript();

  assert.match(client, /addEventListener\('beforeinstallprompt'/);
  assert.match(client, /event\.preventDefault\(\)/);
  assert.match(client, /deferredInstallPrompt=event/);
  assert.match(client, /data-shiloh-browser-install/);
  assert.match(client, /Install Shiloh/);
  assert.match(client, /button\.addEventListener\('click'/);
  assert.match(client, /await prompt\.prompt\(\)/);
  assert.match(client, /prompt\.userChoice/);
  assert.match(client, /addEventListener\('appinstalled'/);
  assert.match(client, /deferredInstallPrompt=null/);

  assert.match(client, /if\(!androidDevice\(\)\|\|standalone\(\)\)return/);
  assert.match(client, /beforeinstallprompt'[\s\S]*if\(!androidDevice\(\)\|\|standalone\(\)\)return/);
  assert.match(client, /Keep Shiloh close/);
  assert.match(client, /Add to Home Screen/);

  assert.match(client, /sessionStorage\.setItem\(INSTALL_DISMISS_KEY,'1'\)/);
  assert.doesNotMatch(client, /localStorage|indexedDB|document\.cookie|Authorization|Bearer\s|navigator\.credentials|permissions\s*=|calendar_scope\s*=/i);
});
