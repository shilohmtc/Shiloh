const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lifecycle = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'appointmentLifecycle.js'), 'utf8');
const finalization = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'adminAppointmentFinalization.js'), 'utf8');

test('post-appointment client followups require explicit completed attendance', () => {
  const claim = lifecycle.match(/async function claimDueFollowup\(\)[\s\S]*?async function undoClaim/);
  assert.ok(claim);
  assert.match(claim[0], /WHERE status='completed' AND followup_sent_at IS NULL/);
  assert.doesNotMatch(claim[0], /confirmed_by_client/);
  assert.doesNotMatch(claim[0], /status IN \('confirmed'/);
});

test('followup delivery remains claimed transactionally and is retryable only on send failure', () => {
  assert.match(lifecycle, /FOR UPDATE SKIP LOCKED LIMIT 1/);
  assert.match(lifecycle, /followup_sent_at=NOW\(\)/);
  assert.match(lifecycle, /if \(!providerAccepted\) await releaseClaim\(appointment\.id\)/);
});

test('explicit attendance finalization synchronizes canonical lifecycle status', () => {
  assert.match(finalization, /FINAL_STATUSES = new Set\(\['completed', 'no_show', 'no_charge'\]\)/);
  assert.match(finalization, /UPDATE appointment_lifecycle SET status=\$1,updated_at=NOW\(\) WHERE appointment_id=\$2/);
  assert.match(finalization, /Explicit WhatsApp practitioner attendance certification/);
});

const { deliverClaimedFollowup } = require('../src/services/appointmentLifecycle');
const claimed={id:7,appointment_id:70,phone:'27000000000',service_text:'Service'};

test('provider acceptance remains claimed when delivery evidence update fails', async () => {
  let releases=0, experiences=0;
  const result=await deliverClaimedFollowup(claimed,'shiloh_appointment_followup_v2',true,{name:'Client',env:{SHILOH_META_SIGNIN_ONLY_ENABLED:'false'},send:async()=>({messages:[{id:'wamid.accepted'}]}),updateEvidence:async()=>{throw new Error('database evidence failure');},createExperience:async()=>{experiences++;},releaseClaim:async()=>{releases++;}});
  assert.equal(result.providerMessageId,'wamid.accepted');assert.equal(releases,0);assert.equal(experiences,1);
});

test('provider acceptance remains claimed when experience bookkeeping fails', async () => {
  let releases=0, evidence=0;
  const result=await deliverClaimedFollowup(claimed,'shiloh_appointment_followup_v2',true,{name:'Client',env:{SHILOH_META_SIGNIN_ONLY_ENABLED:'false'},send:async()=>({messages:[{id:'wamid.accepted'}]}),updateEvidence:async()=>{evidence++;},createExperience:async()=>{throw new Error('experience failure');},releaseClaim:async()=>{releases++;}});
  assert.equal(result.sent,true);assert.equal(evidence,1);assert.equal(releases,0);
});

test('provider rejection is the only follow-up path that releases the claim', async () => {
  let releases=0;
  await assert.rejects(()=>deliverClaimedFollowup(claimed,'shiloh_appointment_followup_v2',true,{name:'Client',env:{SHILOH_META_SIGNIN_ONLY_ENABLED:'false'},send:async()=>{throw new Error('provider rejected');},releaseClaim:async()=>{releases++;}}),/provider rejected/);
  assert.equal(releases,1);
});
