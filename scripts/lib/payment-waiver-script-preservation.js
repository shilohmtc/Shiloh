'use strict';
const assert = require('node:assert/strict');
function assertPaymentScriptPreservation(before, after, completedRewardScript) {
  if (before === after) return { byteIdentical: true, approvedRewardExtension: false };
  assert.ok(completedRewardScript && !before.includes(completedRewardScript), 'Existing reward code must not change under this extension exception');
  assert.equal(after.split(completedRewardScript).length, 2, 'Exactly one completed reward extension is permitted');
  const guarded = "if(reward&&!reward.hasAttribute('data-completed-rewards'))reward.addEventListener";
  const legacy = 'if(reward)reward.addEventListener';
  assert.equal(after.split(guarded).length, 2, 'The exact legacy reward dispatch guard is required');
  const normalized = after.replace(completedRewardScript, '').replace(guarded, legacy);
  assert.equal(normalized, before, 'All payment script code outside the explicit completed reward extension must remain identical');
  return { byteIdentical: false, approvedRewardExtension: true };
}
module.exports = { assertPaymentScriptPreservation };
