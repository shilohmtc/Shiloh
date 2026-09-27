'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getMyShilohCutoverCoverage } = require('../src/services/myShilohCutoverCoverage');

test('cutover coverage returns only cohort counts and never client identity', async () => {
  const db = { async query(sql) {
    assert.match(sql, /status IN \('scheduled','confirmed'\)/);
    assert.match(sql, /last_push_status LIKE 'accepted_%'/);
    assert.match(sql, /crm_v2_client_id IS NULL AND client_id IS NOT NULL/);
    return { rows: [{
      active_v2_clients: 17, active_v2_with_push: 4, active_v2_recently_accepted: 3,
      upcoming_v2_clients: 9, upcoming_v2_with_push: 2, upcoming_v2_recently_accepted: 1,
      upcoming_legacy_clients: 6, legacy_birthday_opted_in: 5,
      receipt_claims_for_review: 0, deposit_claims_for_review: 1,
      name: 'Private Client', normalized_mobile: '27820000000',
    }] };
  } };
  assert.deepEqual(await getMyShilohCutoverCoverage(db), {
    windowDays: 30, activeV2Clients: 17, activeV2WithPush: 4,
    activeV2RecentlyAccepted: 3, upcomingV2Clients: 9,
    upcomingV2WithPush: 2, upcomingV2RecentlyAccepted: 1,
    upcomingLegacyClients: 6, legacyBirthdayOptedIn: 5,
    receiptClaimsForReview: 0, depositClaimsForReview: 1,
  });
});
