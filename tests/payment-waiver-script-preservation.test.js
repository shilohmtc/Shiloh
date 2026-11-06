const test=require('node:test'),assert=require('node:assert/strict');
const {assertPaymentScriptPreservation:check}=require('../scripts/lib/payment-waiver-script-preservation');
const legacy='waiver();cash();if(reward)reward.addEventListener();ozow();',extension='completedReward();';
const allowed=extension+legacy.replace('if(reward)reward.addEventListener',"if(reward&&!reward.hasAttribute('data-completed-rewards'))reward.addEventListener");
test('unchanged payment script and the exact approved reward extension are accepted',()=>{assert.equal(check(legacy,legacy,extension).byteIdentical,true);assert.equal(check(legacy,allowed,extension).approvedRewardExtension,true);});
test('cash, waiver, provider and duplicate extension drift still fail preservation',()=>{for(const value of [allowed.replace('waiver();','waiverChanged();'),allowed.replace('cash();','cashChanged();'),allowed.replace('ozow();','providerChanged();'),extension+allowed,allowed.replace("&&!reward.hasAttribute('data-completed-rewards')",'')])assert.throws(()=>check(legacy,value,extension));});
test('an existing completed-reward implementation cannot use the extension exception for later drift',()=>{assert.throws(()=>check(allowed,allowed+'unrelated();',extension));});
