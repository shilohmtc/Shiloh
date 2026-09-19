'use strict';

const { pool } = require('../db/pool');
const { resolveCalendarAuthority, hasCapability } = require('./calendarAuthorization');

const CAPABILITIES = Object.freeze({ VIEW:'loyalty:view', REDEEM:'loyalty:redeem', MANAGE:'loyalty:manage' });

class ShilohRewardsError extends Error {
  constructor(code, message, httpStatus=400) { super(message); this.code=code; this.httpStatus=httpStatus; }
}

function positiveId(value, label='record') {
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<=0) throw new ShilohRewardsError('REWARDS_INVALID_ID',`A valid ${label} is required.`);
  return id;
}

function money(value,{positive=false}={}) {
  const raw=String(value??'').trim();
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) throw new ShilohRewardsError('REWARDS_INVALID_AMOUNT','Enter a valid Rand amount with at most two decimals.');
  const cents=Math.round(Number(raw)*100);
  if(!Number.isSafeInteger(cents)||(positive&&cents<1)||Math.abs(cents)>999999999999) throw new ShilohRewardsError('REWARDS_INVALID_AMOUNT','The reward amount is outside the supported range.');
  return (cents/100).toFixed(2);
}

function operationKey(value) {
  const key=String(value||'').trim();
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new ShilohRewardsError('REWARDS_INVALID_REQUEST','A valid operation request identifier is required.');
  return key;
}

function rewardAmount(value,basisPoints=500) {
  const cents=Math.round(Number(value)*100);
  const rewardCents=Math.round(cents*Number(basisPoints)/10000);
  return (rewardCents/100).toFixed(2);
}

function createShilohRewardsService({db=pool}={}) {
  async function settings(queryable=db) {
    const row=(await queryable.query(`SELECT earn_basis_points,unlock_threshold,expiry_mode,activated_at FROM loyalty_program_settings WHERE singleton=TRUE`)).rows[0];
    if(!row) throw new ShilohRewardsError('REWARDS_NOT_CONFIGURED','Shiloh Rewards is temporarily unavailable.',503);
    return {earnRate:Number(row.earn_basis_points)/100,earnBasisPoints:Number(row.earn_basis_points),unlockThreshold:Number(row.unlock_threshold),expiryMode:row.expiry_mode,activatedAt:row.activated_at};
  }

  async function ensureWallet(queryable,crmV2ClientId) {
    const id=positiveId(crmV2ClientId,'client');
    const active=(await queryable.query(`SELECT id FROM crm_v2_clients WHERE id=$1 AND status='active'`,[id])).rows[0];
    if(!active) throw new ShilohRewardsError('REWARDS_CLIENT_UNAVAILABLE','The active Shiloh client profile is unavailable.',404);
    return (await queryable.query(`INSERT INTO loyalty_wallets(crm_v2_client_id) VALUES($1) ON CONFLICT(crm_v2_client_id) DO UPDATE SET updated_at=loyalty_wallets.updated_at RETURNING *`,[id])).rows[0];
  }

  async function walletPosition(queryable,walletId) {
    const row=(await queryable.query(`SELECT COALESCE(SUM(signed_amount),0)::numeric(12,2) AS balance,COALESCE(SUM(signed_amount) FILTER(WHERE signed_amount>0),0)::numeric(12,2) AS credited,COALESCE(-SUM(signed_amount) FILTER(WHERE signed_amount<0),0)::numeric(12,2) AS used FROM loyalty_wallet_entries WHERE wallet_id=$1`,[walletId])).rows[0];
    return {balance:Number(row?.balance||0),credited:Number(row?.credited||0),used:Number(row?.used||0)};
  }

  async function syncEligibleEarnings() {
    const config=await settings(db);
    const candidates=await db.query(
      `SELECT ple.id,ple.entry_type,ple.amount,bpa.id AS booking_payment_account_id,
              COALESCE(ple.payer_crm_v2_client_id,pr.payer_crm_v2_client_id,
                (SELECT c.id FROM crm_v2_clients c WHERE c.status='active' AND c.normalized_mobile=REGEXP_REPLACE(COALESCE(pr.payer_mobile,''),'[^0-9]','','g') LIMIT 1),
                a.crm_v2_client_id) AS reward_client_id,
              COALESCE(bpa.appointment_id,(SELECT gm.appointment_id FROM appointment_group_members gm WHERE gm.group_id=bpa.appointment_group_id ORDER BY gm.guest_position,gm.appointment_id LIMIT 1)) AS appointment_id
         FROM payment_ledger_entries ple
         JOIN booking_payment_accounts bpa ON bpa.id=ple.payment_account_id
         LEFT JOIN payment_requests pr ON pr.id=ple.payment_request_id
         LEFT JOIN appointments a ON a.id=bpa.appointment_id
         LEFT JOIN loyalty_wallet_entries existing ON existing.source_payment_ledger_entry_id=ple.id
         JOIN loyalty_program_settings cfg ON cfg.singleton=TRUE
        WHERE existing.id IS NULL
          AND ple.created_at>=cfg.activated_at
          AND (
            (bpa.appointment_id IS NOT NULL AND a.status='completed') OR
            (bpa.appointment_group_id IS NOT NULL
              AND EXISTS(SELECT 1 FROM appointment_group_members gm JOIN appointments ga ON ga.id=gm.appointment_id WHERE gm.group_id=bpa.appointment_group_id AND ga.status='completed')
              AND NOT EXISTS(SELECT 1 FROM appointment_group_members gm JOIN appointments ga ON ga.id=gm.appointment_id WHERE gm.group_id=bpa.appointment_group_id AND ga.status NOT IN ('completed','cancelled')))
          )
        ORDER BY ple.id`,
    );
    let recorded=0,skipped=0;
    for(const row of candidates.rows) {
      if(!row.reward_client_id){skipped++;continue;}
      let amount=rewardAmount(row.amount,config.earnBasisPoints);
      if(Number(amount)<=0){skipped++;continue;}
      const client=await db.connect();
      try{
        await client.query('BEGIN');
        const wallet=await ensureWallet(client,row.reward_client_id);
        await client.query(`SELECT id FROM loyalty_wallets WHERE id=$1 FOR UPDATE`,[wallet.id]);
        const reversal=row.entry_type==='refund';
        if(reversal){const earned=(await client.query(`SELECT COALESCE(SUM(signed_amount),0) AS amount FROM loyalty_wallet_entries WHERE wallet_id=$1 AND booking_payment_account_id=$2 AND entry_type IN ('earn','earn_reversal')`,[wallet.id,row.booking_payment_account_id])).rows[0];const reversible=Math.max(0,Number(earned?.amount||0));if(reversible===0){await client.query('ROLLBACK');skipped++;continue;}amount=Math.min(Number(amount),reversible).toFixed(2);}
        const inserted=await client.query(`INSERT INTO loyalty_wallet_entries(wallet_id,entry_type,signed_amount,operation_key,source_payment_ledger_entry_id,booking_payment_account_id,appointment_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source_payment_ledger_entry_id) DO NOTHING RETURNING id`,[wallet.id,reversal?'earn_reversal':'earn',reversal?`-${amount}`:amount,`${reversal?'refund':'earn'}:payment-ledger:${row.id}`,row.id,row.booking_payment_account_id,row.appointment_id,reversal?'Automatic reward reversal after refund':'5% Shiloh Reward on completed, paid treatment']);
        await client.query('COMMIT');
        if(inserted.rowCount)recorded++;
      }catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}finally{client.release();}
    }
    return {recorded,skipped};
  }

  async function syncCancelledRedemptions() {
    const rows=await db.query(`SELECT bla.*,bpa.appointment_id,bpa.appointment_group_id,lwe.signed_amount FROM booking_loyalty_allocations bla JOIN booking_payment_accounts bpa ON bpa.id=bla.booking_payment_account_id JOIN loyalty_wallet_entries lwe ON lwe.id=bla.debit_entry_id WHERE bla.state='applied' AND ((bpa.appointment_id IS NOT NULL AND EXISTS(SELECT 1 FROM appointments a WHERE a.id=bpa.appointment_id AND a.status='cancelled')) OR (bpa.appointment_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM appointment_group_members gm JOIN appointments a ON a.id=gm.appointment_id WHERE gm.group_id=bpa.appointment_group_id AND a.status<>'cancelled'))) ORDER BY bla.id`);
    let reversed=0;
    for(const allocation of rows.rows){
      const client=await db.connect();
      try{await client.query('BEGIN');const locked=(await client.query(`SELECT * FROM booking_loyalty_allocations WHERE id=$1 FOR UPDATE`,[allocation.id])).rows[0];if(locked?.state==='applied'){await client.query(`INSERT INTO loyalty_wallet_entries(wallet_id,entry_type,signed_amount,operation_key,booking_payment_account_id,appointment_id,notes) VALUES($1,'redemption_reversal',$2,$3,$4,$5,'Automatic return after booking cancellation') ON CONFLICT(operation_key) DO NOTHING`,[allocation.wallet_id,allocation.amount,`cancelled:allocation:${allocation.id}`,allocation.booking_payment_account_id,allocation.appointment_id]);await client.query(`UPDATE booking_loyalty_allocations SET state='reversed',reversed_at=NOW() WHERE id=$1`,[allocation.id]);reversed++;}await client.query('COMMIT');}catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}finally{client.release();}
    }
    return {reversed};
  }

  async function getClientModel({crmV2ClientId}={}) {
    await syncEligibleEarnings();await syncCancelledRedemptions();
    const clientId=positiveId(crmV2ClientId,'client');
    const client=(await db.query(`SELECT id,name FROM crm_v2_clients WHERE id=$1 AND status='active'`,[clientId])).rows[0];
    if(!client)throw new ShilohRewardsError('REWARDS_CLIENT_UNAVAILABLE','Your active Shiloh client profile is unavailable.',404);
    const wallet=await ensureWallet(db,clientId);const [config,position,entries,appointments]=await Promise.all([settings(db),walletPosition(db,wallet.id),db.query(`SELECT entry_type,signed_amount,notes,created_at FROM loyalty_wallet_entries WHERE wallet_id=$1 ORDER BY id DESC LIMIT 50`,[wallet.id]),db.query(`SELECT a.id,a.starts_at,a.status,a.total_price,COALESCE((SELECT string_agg(service_name_snapshot,' + ' ORDER BY position) FROM appointment_services WHERE appointment_id=a.id),a.title,'Shiloh appointment') AS service_name FROM appointments a WHERE a.crm_v2_client_id=$1 AND a.client_id IS NULL AND a.status IN ('scheduled','confirmed') AND a.ends_at>NOW() ORDER BY a.starts_at LIMIT 10`,[clientId])]);
    return {client:{id:clientId,name:client.name},wallet:{...position,unlocked:position.balance>=config.unlockThreshold},policy:config,entries:entries.rows,appointments:appointments.rows};
  }

  async function bookingAccount(queryable,appointmentId,{create=false}={}) {
    const id=positiveId(appointmentId,'appointment');
    const subject=(await queryable.query(`SELECT a.id,a.crm_v2_client_id,a.status,a.total_price,a.currency,a.updated_at,g.id AS group_id,g.status AS group_status,COALESCE(g.final_total,g.total_price) AS group_total,g.updated_at AS group_revision FROM appointments a LEFT JOIN appointment_group_members gm ON gm.appointment_id=a.id LEFT JOIN appointment_groups g ON g.id=gm.group_id WHERE a.id=$1 ${create?'FOR UPDATE OF a':''}`,[id])).rows[0];
    if(!subject)throw new ShilohRewardsError('REWARDS_BOOKING_NOT_FOUND','That booking is no longer available.',404);
    if(['cancelled','completed'].includes(String(subject.group_id?subject.group_status:subject.status)))throw new ShilohRewardsError('REWARDS_BOOKING_UNAVAILABLE','Rewards can only be added to an upcoming booking.',409);
    const column=subject.group_id?'appointment_group_id':'appointment_id',value=subject.group_id||subject.id,due=Number(subject.group_id?subject.group_total:subject.total_price),revision=subject.group_id?subject.group_revision:subject.updated_at;
    if(!Number.isFinite(due)||due<0)throw new ShilohRewardsError('REWARDS_PRICE_UNAVAILABLE','The booking price must be confirmed before rewards can be used.',409);
    let account=(await queryable.query(`SELECT * FROM booking_payment_accounts WHERE ${column}=$1 ${create?'FOR UPDATE':''}`,[value])).rows[0];
    if(!account&&create)account=(await queryable.query(`INSERT INTO booking_payment_accounts(${column},canonical_amount_due,currency,pricing_revision) VALUES($1,$2,$3,$4) ON CONFLICT(${column}) WHERE ${column} IS NOT NULL DO UPDATE SET updated_at=booking_payment_accounts.updated_at RETURNING *`,[value,due,subject.currency||'ZAR',revision])).rows[0];
    return {subject,account,due};
  }

  async function accountOutstanding(queryable,account,due) {
    if(!account)return due;
    const row=(await queryable.query(`SELECT COALESCE((SELECT SUM(CASE WHEN entry_type='payment' THEN amount ELSE -amount END) FROM payment_ledger_entries WHERE payment_account_id=$1),0) AS net_paid,COALESCE((SELECT SUM(amount) FROM booking_loyalty_allocations WHERE booking_payment_account_id=$1 AND state='applied'),0) AS rewards`,[account.id])).rows[0];
    return Math.max(0,Number(due)-Number(row.net_paid||0)-Number(row.rewards||0));
  }

  async function applyCredit({crmV2ClientId,appointmentId,amount,operationId,clientSessionId=null,adminId=null,clientConfirmed=false}={}) {
    const clientId=positiveId(crmV2ClientId,'client'),key=operationKey(operationId),requested=money(amount,{positive:true});
    if((clientSessionId?1:0)+(adminId?1:0)!==1)throw new ShilohRewardsError('REWARDS_ACTOR_REQUIRED','A secure client or staff session is required.',401);
    if(adminId&&!clientConfirmed)throw new ShilohRewardsError('REWARDS_CONFIRMATION_REQUIRED','Confirm that the client agreed to use their Shiloh Rewards.',400);
    const client=await db.connect();
    try{await client.query('BEGIN');const {subject,account,due}=await bookingAccount(client,appointmentId,{create:true});const owns=subject.group_id?(await client.query(`SELECT 1 FROM appointment_group_members gm JOIN appointments a ON a.id=gm.appointment_id WHERE gm.group_id=$1 AND a.crm_v2_client_id=$2 LIMIT 1`,[subject.group_id,clientId])).rowCount>0:Number(subject.crm_v2_client_id)===clientId;if(!owns)throw new ShilohRewardsError('REWARDS_BOOKING_FORBIDDEN','That booking does not belong to this Shiloh client.',403);const wallet=await ensureWallet(client,clientId);await client.query(`SELECT id FROM loyalty_wallets WHERE id=$1 FOR UPDATE`,[wallet.id]);const replay=(await client.query(`SELECT id,state,amount FROM booking_loyalty_allocations WHERE operation_key=$1`,[`redeem:${key}`])).rows[0];if(replay){await client.query('COMMIT');return{status:'idempotent_replay',allocation:replay};}const config=await settings(client),position=await walletPosition(client,wallet.id),outstanding=await accountOutstanding(client,account,due);if(position.balance<config.unlockThreshold)throw new ShilohRewardsError('REWARDS_NOT_UNLOCKED',`Your rewards unlock when the balance reaches R${config.unlockThreshold.toFixed(2)}.`,409);if(Number(requested)>position.balance)throw new ShilohRewardsError('REWARDS_EXCEEDS_BALANCE','That amount is greater than the available Shiloh Rewards balance.',409);if(Number(requested)>outstanding)throw new ShilohRewardsError('REWARDS_EXCEEDS_BOOKING_BALANCE','That amount is greater than the booking balance.',409);const debit=(await client.query(`INSERT INTO loyalty_wallet_entries(wallet_id,entry_type,signed_amount,operation_key,booking_payment_account_id,appointment_id,actor_admin_id,notes) VALUES($1,'redeem',$2,$3,$4,$5,$6,'Applied to a Shiloh booking') RETURNING *`,[wallet.id,`-${requested}`,`redeem:${key}`,account.id,subject.id,adminId||null])).rows[0];const allocation=(await client.query(`INSERT INTO booking_loyalty_allocations(booking_payment_account_id,wallet_id,debit_entry_id,amount,applied_by_client_session_id,applied_by_admin_id,client_confirmed,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[account.id,wallet.id,debit.id,requested,clientSessionId||null,adminId||null,Boolean(clientSessionId)||Boolean(clientConfirmed),`redeem:${key}`])).rows[0];await client.query('COMMIT');return{status:'applied',allocation,balance:position.balance-Number(requested),outstanding:outstanding-Number(requested)};}catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}finally{client.release();}
  }

  async function applyStaffCredit({adminId,crmV2ClientId,appointmentId,amount,operationId,clientConfirmed}={}) {
    await resolveOperator(db,adminId,CAPABILITIES.REDEEM);
    return applyCredit({adminId,crmV2ClientId,appointmentId,amount,operationId,clientConfirmed});
  }

  async function resolveOperator(queryable,adminId,capability){const operator=await resolveCalendarAuthority(queryable,positiveId(adminId,'staff account'),{additionalCapabilities:Object.values(CAPABILITIES)});if(!operator||!hasCapability(operator.calendarAuthority,capability))throw new ShilohRewardsError('REWARDS_FORBIDDEN','Current Shiloh authority does not permit this rewards operation.',403);return operator;}

  async function resolveAdjustmentClient(queryable,value){const text=String(value||'').trim();if(!text)throw new ShilohRewardsError('REWARDS_CLIENT_REQUIRED','Enter the client’s name or mobile number.');let digits=text.replace(/[^0-9]/g,'');if(/^0[678][0-9]{8}$/.test(digits))digits=`27${digits.slice(1)}`;const result=await queryable.query(`SELECT id FROM crm_v2_clients WHERE status='active' AND (normalized_mobile=$1 OR LOWER(name)=LOWER($2)) ORDER BY id LIMIT 2`,[digits,text]);if(result.rowCount!==1)throw new ShilohRewardsError('REWARDS_CLIENT_AMBIGUOUS','Please use the client’s exact Shiloh mobile number so we can safely identify one profile.',409);return Number(result.rows[0].id);}

  async function getWorkspaceModel({adminId}={}){const operator=await resolveOperator(db,adminId,CAPABILITIES.VIEW);await syncEligibleEarnings();await syncCancelledRedemptions();const [config,wallets]=await Promise.all([settings(db),db.query(`SELECT w.id,w.crm_v2_client_id,c.name,c.normalized_mobile,COALESCE(SUM(e.signed_amount),0)::numeric(12,2) AS balance,MAX(e.created_at) AS latest_activity FROM loyalty_wallets w JOIN crm_v2_clients c ON c.id=w.crm_v2_client_id LEFT JOIN loyalty_wallet_entries e ON e.wallet_id=w.id GROUP BY w.id,c.id ORDER BY MAX(e.created_at) DESC NULLS LAST,c.name LIMIT 200`)]);return{policy:config,wallets:wallets.rows,authority:{canManage:hasCapability(operator.calendarAuthority,CAPABILITIES.MANAGE),canRedeem:hasCapability(operator.calendarAuthority,CAPABILITIES.REDEEM)}};}

  async function resolveAccess(adminId){try{return await resolveOperator(db,adminId,CAPABILITIES.VIEW);}catch(error){if(error instanceof ShilohRewardsError&&error.httpStatus===403)return null;throw error;}}

  async function adjust({adminId,clientSearch,amount,direction,notes,operationId}={}){const selected=String(direction||'');if(!['add','remove'].includes(selected))throw new ShilohRewardsError('REWARDS_INVALID_DIRECTION','Choose whether to add or remove reward credit.');const value=money(amount,{positive:true}),key=operationKey(operationId);const client=await db.connect();try{await client.query('BEGIN');const operator=await resolveOperator(client,adminId,CAPABILITIES.MANAGE);const clientId=await resolveAdjustmentClient(client,clientSearch);const wallet=await ensureWallet(client,clientId);await client.query(`SELECT id FROM loyalty_wallets WHERE id=$1 FOR UPDATE`,[wallet.id]);const adjustmentKey=`adjustment:${operator.id}:${key}`;const replay=(await client.query(`SELECT * FROM loyalty_wallet_entries WHERE operation_key=$1`,[adjustmentKey])).rows[0];if(replay){await client.query('COMMIT');return{status:'idempotent_replay',entry:replay};}const position=await walletPosition(client,wallet.id);if(selected==='remove'&&Number(value)>position.balance)throw new ShilohRewardsError('REWARDS_EXCEEDS_BALANCE','That adjustment is greater than the client’s rewards balance.',409);const entry=(await client.query(`INSERT INTO loyalty_wallet_entries(wallet_id,entry_type,signed_amount,operation_key,actor_admin_id,notes) VALUES($1,'adjustment',$2,$3,$4,$5) RETURNING *`,[wallet.id,selected==='remove'?`-${value}`:value,adjustmentKey,operator.id,String(notes||'').trim().slice(0,240)||null])).rows[0];await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'loyalty.adjusted','loyalty_wallet',$2,$3::jsonb)`,[operator.id,wallet.id,JSON.stringify({direction:selected,amount:value,noteProvided:Boolean(String(notes||'').trim())})]);await client.query('COMMIT');return{status:'adjusted',entry};}catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}finally{client.release();}}

  async function getClientBalance(crmV2ClientId){const model=await getClientModel({crmV2ClientId});return{balance:model.wallet.balance,unlocked:model.wallet.unlocked,unlockThreshold:model.policy.unlockThreshold,earnRate:model.policy.earnRate};}

  return{settings,syncEligibleEarnings,syncCancelledRedemptions,getClientModel,getClientBalance,getWorkspaceModel,resolveAccess,applyCredit,applyStaffCredit,adjust,accountOutstanding};
}

module.exports={CAPABILITIES,ShilohRewardsError,money,rewardAmount,createShilohRewardsService};
