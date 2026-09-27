'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceChangeDeliveryAttentionService, canReviewChangeDelivery } = require('../src/services/workspaceChangeDeliveryAttention');
const { renderMessagesPage } = require('../src/presentation/workspaceMessagesUx');

const clinic = { businessRole:'owner', clientScope:{kind:'clinic',ownerStaffId:null} };
const notice = { operatorAdminId:7 };

test('only clinic coordinators with notification authority see change delivery failures', async () => {
  assert.equal(canReviewChangeDelivery(clinic,notice), true);
  assert.equal(canReviewChangeDelivery({ ...clinic,businessRole:'booking_operator' },notice), true);
  assert.equal(canReviewChangeDelivery({ ...clinic,businessRole:'practitioner' },notice), false);
  assert.equal(canReviewChangeDelivery({ ...clinic,clientScope:{kind:'tenant_staff',ownerStaffId:12} },notice), false);
  assert.equal(canReviewChangeDelivery(clinic,null), false);
  let sql;
  const service=createWorkspaceChangeDeliveryAttentionService({ db:{async query(statement,values){sql=statement;assert.deepEqual(values,[]);
    return {rows:[{audit_event_id:701,appointment_id:668,client_id:912,client_name:'Michelle <script>',change_kind:'time',status:'sending',updated_at:'2026-09-27T07:00:00Z'}]};}} });
  assert.deepEqual(await service.list({ authority:{...clinic,businessRole:'practitioner'},notificationAuthority:notice }),[]);
  assert.equal(sql,undefined);
  const rows=await service.list({authority:clinic,notificationAuthority:notice});
  assert.equal(rows[0].status,'uncertain');
  assert.match(rows[0].nextAction,/may have accepted/);
  assert.match(sql,/crm_v2_client_relationships/);
  assert.match(sql,/relationship_type='clinic'/);
  assert.match(sql,/service_visibility_policies/);
  assert.match(sql,/status='sending'.*15 minutes/s);
  assert.doesNotMatch(sql,/n\.last_error\s*,|provider_error|normalized_mobile/);
});

test('Messages presents uncertain update as staff review without raw error or duplicate-send control', () => {
  const html=renderMessagesPage({authority:clinic,selectedView:'attention',notificationAuthority:notice,
    attention:[],changeAttention:[{id:701,appointmentId:668,clientId:912,clientName:'Michelle <script>',
      label:'Appointment update',status:'uncertain',statusLabel:'Send status uncertain',updatedAt:'2026-09-27T07:00:00Z',
      nextAction:'Check the client communication record before any new send. WhatsApp may have accepted the previous attempt.'}]});
  assert.match(html,/data-change-delivery-attention="701"/);
  assert.match(html,/Review client/);
  assert.match(html,/Send status uncertain/);
  assert.doesNotMatch(html,/<script>.*Michelle|data-booking-confirmation-recover/);
  assert.match(html,/Michelle &lt;script&gt;/);
});
