'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { workspacePwaClientScript } = require('../src/presentation/workspacePwa');

test('#837 Android install UI waits for a genuine Chromium install prompt', () => {
  const client = workspacePwaClientScript();
  assert.match(client, /function androidDevice\(\).*Android/s);
  assert.match(client, /function installAction\(\)\{if\(!androidDevice\(\)\|\|standalone\(\)\|\|!deferredInstallPrompt\)/);
  assert.match(client, /Install Shiloh on this Android phone/);
  assert.doesNotMatch(client, /tap the ⋮ menu, then choose Install app or Add to Home screen/);
  assert.match(client, /beforeinstallprompt',event=>\{if\(!androidDevice\(\)\|\|standalone\(\)\)return/);
});

test('#837 native Chromium prompt enables the single Android install control', () => {
  const client = workspacePwaClientScript();
  const listenerAt = client.indexOf("addEventListener('beforeinstallprompt'");
  const initialRenderAt = client.indexOf('installGuidance();installAction();');
  assert.ok(listenerAt >= 0 && initialRenderAt > listenerAt, 'capture listener must be installed before initial install UI evaluation');
  assert.match(client, /beforeinstallprompt[\s\S]*event\.preventDefault\(\)[\s\S]*deferredInstallPrompt=event[\s\S]*removeInstallCard\('\[data-shiloh-browser-install\]'\)[\s\S]*installAction\(\)/);
  assert.match(client, /button\.textContent='Install Shiloh'/);
  assert.match(client, /await prompt\.prompt\(\)/);
  assert.match(client, /userChoice/);
});

test('#837 installed and iPhone paths remain bounded', () => {
  const client = workspacePwaClientScript();
  assert.match(client, /Keep Shiloh close/);
  assert.match(client, /Tap Share/);
  assert.match(client, /Choose Add to Home Screen/);
  assert.match(client, /appinstalled[\s\S]*removeInstallCard\('\[data-shiloh-browser-install\]'\)[\s\S]*removeInstallCard\('\[data-shiloh-ios-install\]'\)/);
  assert.match(client, /document\.documentElement\.dataset\.shilohPwaMode='standalone'/);
  assert.match(client, /sessionStorage\.setItem\(INSTALL_DISMISS_KEY,'1'\)/);
  assert.doesNotMatch(client, /localStorage|indexedDB|document\.cookie|Authorization|Bearer\s|pushManager|showNotification/i);
});
