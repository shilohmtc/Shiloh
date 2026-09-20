'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  WELCOME_VOUCHER_REPORT_CAPABILITY,
  canViewWelcomeVoucherCampaign,
  createWorkspaceWelcomeVoucherCampaignService,
} = require('../src/services/workspaceWelcomeVoucherCampaign');
const {
  welcomeVoucherDashboardPanel,
} = require('../src/presentation/workspaceDashboardUx');
const {
  welcomeVoucherCampaignSection,
} = require('../src/presentation/workspaceReportsUx');

function owner(overrides = {}) {
  return {
    id: 14,
    display_name: 'Christel',
    active: true,
    business_role: 'owner',
    permissions: { [WELCOME_VOUCHER_REPORT_CAPABILITY]: true },
    ...overrides,
  };
}

function campaign() {
  return {
    launchedAt: '2026-09-20T00:00:00.000Z',
    registrationsCompleted: 12,
    vouchersUnlocked: 10,
    vouchersRedeemed: 4,
    redemptionPercent: 40,
    expiringSoon: 2,
    discountsGiven: 400,
    bookingRevenueReceived: 2100,
    recentActivity: [{
      voucherId: 8,
      clientFirstName: 'Dinah',
      state: 'redeemed',
      amount: 100,
      issuedAt: '2026-09-20T08:00:00.000Z',
      expiresAt: '2026-11-19T08:00:00.000Z',
      redeemedAt: '2026-09-21T08:00:00.000Z',
      treatment: 'Swedish Massage',
    }],
  };
}

test('campaign authority requires both the private capability and owner-level role', () => {
  assert.equal(canViewWelcomeVoucherCampaign(owner()), true);
  assert.equal(canViewWelcomeVoucherCampaign(owner({ permissions: {} })), false);
  assert.equal(canViewWelcomeVoucherCampaign(owner({ business_role: 'employee_practitioner' })), false);
  assert.equal(canViewWelcomeVoucherCampaign(owner({ active: false })), false);
});

test('ordinary practitioners fail closed before any campaign data query', async () => {
  const calls = [];
  const service = createWorkspaceWelcomeVoucherCampaignService({
    db: {
      async query(sql) {
        calls.push(sql);
        return { rows: [owner({ business_role: 'employee_practitioner', permissions: {} })] };
      },
    },
  });
  assert.equal(await service.buildCampaign({ adminId: 22 }), null);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /workspaceWelcomeVoucherCampaign:principal/);
});

test('authorized reporting uses ledger truth and returns privacy-minimized activity', async () => {
  const calls = [];
  const service = createWorkspaceWelcomeVoucherCampaignService({
    db: {
      async query(sql) {
        calls.push(sql);
        if (sql.includes(':principal')) return { rows: [owner()] };
        if (sql.includes(':summary')) return { rows: [{
          launched_at: '2026-09-20T00:00:00.000Z',
          registrations_completed: 9,
          vouchers_unlocked: 8,
          vouchers_redeemed: 3,
          expiring_soon: 1,
          discounts_given: '300.00',
          booking_revenue_received: '1450.00',
        }] };
        if (sql.includes(':activity')) return { rows: [{
          voucher_id: 9,
          client_first_name: 'Dinah',
          state: 'redeemed',
          amount: '100.00',
          issued_at: '2026-09-20T08:00:00.000Z',
          expires_at: '2026-11-19T08:00:00.000Z',
          redeemed_at: '2026-09-21T08:00:00.000Z',
          treatment: 'Swedish Massage',
        }] };
        throw new Error('Unexpected query');
      },
    },
  });
  const model = await service.buildCampaign({ adminId: 14, now: new Date('2026-09-22T10:00:00.000Z') });
  assert.equal(model.redemptionPercent, 37.5);
  assert.equal(model.discountsGiven, 300);
  assert.equal(model.bookingRevenueReceived, 1450);
  assert.deepEqual(model.recentActivity[0], {
    voucherId: 9,
    clientFirstName: 'Dinah',
    state: 'redeemed',
    amount: 100,
    issuedAt: '2026-09-20T08:00:00.000Z',
    expiresAt: '2026-11-19T08:00:00.000Z',
    redeemedAt: '2026-09-21T08:00:00.000Z',
    treatment: 'Swedish Massage',
  });
  const summarySql = calls.find(sql => sql.includes(':summary'));
  assert.match(summarySql, /payment_ledger_entries/);
  assert.match(summarySql, /entry_type='payment'/);
  assert.match(summarySql, /state='applied'/);
  assert.doesNotMatch(summarySql, /total_price/);
  const activitySql = calls.find(sql => sql.includes(':activity'));
  assert.match(activitySql, /SPLIT_PART\(BTRIM\(c\.name\),' ',1\)/);
  assert.doesNotMatch(activitySql, /normalized_mobile|date_of_birth|gender/);
});

test('private campaign UI presents the agreed metrics and escapes activity', () => {
  const dashboard = welcomeVoucherDashboardPanel(campaign());
  assert.match(dashboard, /R100 Welcome Voucher/);
  assert.match(dashboard, /Christel and JP only/);
  assert.match(dashboard, /40%/);

  const report = welcomeVoucherCampaignSection({
    ...campaign(),
    recentActivity: [{ ...campaign().recentActivity[0], clientFirstName: '<Dinah>', treatment: '<Massage>' }],
  });
  assert.match(report, /Completed registrations/);
  assert.match(report, /Booking revenue received/);
  assert.match(report, /R2[\s,\u00a0]100/);
  assert.doesNotMatch(report, /<Dinah>|<Massage>/);
  assert.match(report, /&lt;Dinah&gt;/);
  assert.equal(welcomeVoucherCampaignSection(null), '');
});

test('migration grants the new capability to exactly canonical Christel and JP authority', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '144_workspace_welcome_voucher_reporting.sql'), 'utf8');
  assert.match(sql, /Expected exactly one active canonical Christel owner/);
  assert.match(sql, /Expected exactly one active canonical Jean-Pierre business_admin/);
  assert.match(sql, /welcome_vouchers:view_campaign/);
  assert.match(sql, /must resolve to exactly Christel and Jean-Pierre/);
  assert.doesNotMatch(sql, /employee_practitioner|tenant_practitioner|booking_operator/);
});
