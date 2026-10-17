'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reviewed = require('./fixtures/workspace-meta-reviewed-2026-10-17.json');
const { inspectWorkspaceTemplate, buildWorkspaceOtpPayload } = require('../src/services/workspaceWhatsAppTemplate');
const inspect = actual => inspectWorkspaceTemplate({ reviewed:actual, inventory:[actual], wabaId:actual.wabaId });
const mutateButton = fn => {
  const item = structuredClone(reviewed);
  fn(item.components[2].buttons[0]);
  return item;
};

test('authenticated Meta read form supports en, five-minute TTL and URL Copy code without button otp_type', () => {
  const result = inspect(reviewed);
  assert.equal(result.ready,true);
  assert.equal(result.language,'en');
  assert.equal(result.codeTtlSeconds,300);
  const payload = buildWorkspaceOtpPayload({ template:result, mobile:'27820000001', code:'123456' });
  assert.equal(payload.template.language.code,'en');
  assert.equal(payload.template.components[1].parameters[0].text,'123456');
});

test('URL parser refuses altered hosts, paths, placeholders, expiry, duplicate parameters and fragments', () => {
  const base = reviewed.components[2].buttons[0].url;
  for (const url of [
    base.replace('www.whatsapp.com','evil.invalid'),
    base.replace('/otp/code/','/other/'),
    base.replace('otp{{1}}','otp{{2}}'),
    base.replace('minutes=5','minutes=10'),
    base.replace('COPY_CODE','ONE_TAP'),
    base+'&code=otp{{1}}',base+'&extra=true',base+'#fragment',
    base.replace('https:','http:'),
  ]) assert.equal(inspect(mutateButton(button=>{button.url=url;})).ready,false,url);
  assert.equal(inspect(mutateButton(button=>{button.otp_type='ONE_TAP';})).ready,false);
});

test('semantic compatibility never bypasses exact fresh inventory, approval or locale checks', () => {
  for (const change of [{language:'en_US'},{status:'PAUSED'},{message_send_ttl_seconds:600}]) {
    assert.equal(inspectWorkspaceTemplate({ reviewed, inventory:[{...reviewed,...change}], wabaId:reviewed.wabaId }).ready,false);
  }
  const altered = mutateButton(button=>{button.text='Changed';});
  assert.equal(inspectWorkspaceTemplate({ reviewed, inventory:[altered], wabaId:reviewed.wabaId }).ready,false);
});
