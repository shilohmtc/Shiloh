'use strict';
const fs = require('node:fs');
const { install: installPayments, serviceFor } = require('./priorPaymentFixture');
async function install(db) {
  await installPayments(db);
  await db.query(`ALTER TABLE payment_requests ADD COLUMN payer_crm_v2_client_id BIGINT;
    ALTER TABLE appointments ADD COLUMN source TEXT DEFAULT 'workspace';
    CREATE TABLE appointment_booking_approvals(appointment_id BIGINT PRIMARY KEY,status TEXT);
    UPDATE staff_admin_accounts SET role='owner',business_role='owner' WHERE id=2;
    UPDATE appointments SET status='confirmed',starts_at='2099-10-15T08:00Z',updated_at='2026-10-14T08:00Z' WHERE id IN(201,203);
    ALTER TABLE booking_deposit_requirements ADD COLUMN required_amount NUMERIC(12,2),ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW(),ADD COLUMN satisfied_at TIMESTAMPTZ;
    ALTER TABLE booking_deposit_requirements ADD CONSTRAINT booking_deposit_requirements_state_check CHECK(state IN('awaiting','satisfied','exempt'));
    CREATE TABLE booking_deposit_requirement_members(requirement_id BIGINT,appointment_id BIGINT,required_amount NUMERIC(12,2),eligible_amount NUMERIC(12,2),exemption_reason TEXT,policy_snapshot JSONB);
    INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(80,201,500,'ZAR','2026-10-14T08:00Z');
    INSERT INTO booking_deposit_requirements(id,payment_account_id,state,required_amount) VALUES(90,80,'awaiting',250);
    INSERT INTO booking_deposit_requirement_members VALUES(90,201,250,500,NULL,'{"partialForfeitBasisPoints":5000,"lateForfeitBasisPoints":10000}'::jsonb);
    INSERT INTO payment_requests(id,payment_account_id,request_key,state,amount,purpose,deposit_requirement_id,deposit_member_appointment_id) VALUES(100,80,'synthetic_deposit_link','pending',250,'deposit',90,201);
    INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,external_reference) VALUES(80,'payment',50,'SYNTHETIC-PARTIAL');`);
  await db.query(`ALTER TABLE booking_deposit_requirements ADD COLUMN policy_id SMALLINT DEFAULT 1;
    ALTER TABLE booking_deposit_requirements ADD CONSTRAINT synthetic_original_exempt_zero CHECK((state='exempt' AND required_amount=0) OR state<>'exempt');
    CREATE TABLE clinic_booking_deposit_policy(id SMALLINT PRIMARY KEY,free_notice_hours INT,partial_notice_hours INT,partial_forfeit_basis_points INT,late_forfeit_basis_points INT,no_show_forfeit_basis_points INT);
    INSERT INTO clinic_booking_deposit_policy VALUES(1,48,24,5000,10000,10000);
    CREATE TABLE appointment_status_history(id BIGSERIAL PRIMARY KEY,appointment_id BIGINT,to_status TEXT,changed_at TIMESTAMPTZ);
    CREATE TABLE booking_deposit_policy_events(id BIGSERIAL PRIMARY KEY,appointment_status_history_id BIGINT UNIQUE,requirement_id BIGINT,appointment_id BIGINT,event_type TEXT,notice_minutes INT,forfeit_basis_points INT,member_required_amount NUMERIC(12,2),policy_forfeit_amount NUMERIC(12,2),policy_creditable_amount NUMERIC(12,2),created_at TIMESTAMPTZ DEFAULT NOW());`);
  const authority=fs.readFileSync('migrations/150_booking_deposit_policy.sql','utf8');
  const from=authority.indexOf('CREATE OR REPLACE FUNCTION record_booking_deposit_policy_event()');
  const to=authority.indexOf('EXECUTE FUNCTION record_booking_deposit_policy_event();',from)+'EXECUTE FUNCTION record_booking_deposit_policy_event();'.length;
  if(from<0||to<from)throw Error('Canonical cancellation policy trigger unavailable');
  await db.query(authority.slice(from,to));
  await db.query(fs.readFileSync('migrations/195_booking_deposit_waived_state.sql','utf8'));
}
function input(overrides = {}) {
  return {adminId:2,appointmentId:201,requirementId:90,operationId:'synthetic_waiver_one',expectedRevision:'2026-10-14T08:00:00.000Z',reason:' Agreed deposit exception ',confirmed:true,...overrides};
}
async function snapshot(db) {
  const names=['appointments','booking_payment_accounts','booking_deposit_requirement_members','payment_ledger_entries','booking_prior_payment_entries','treatment_credit_entries'];
  const result={};for(const name of names)result[name]=(await db.query(`SELECT * FROM ${name} ORDER BY 1`)).rows;
  return result;
}
module.exports={install,serviceFor,input,snapshot};
