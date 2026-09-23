'use strict';

function cents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

function moneyFromCents(value) {
  return (Math.max(0, Number(value) || 0) / 100).toFixed(2);
}

function basisPointsAmount(amount, basisPoints) {
  const amountCents = cents(amount);
  const bps = Math.min(10000, Math.max(0, Number(basisPoints) || 0));
  return moneyFromCents(Math.round(amountCents * bps / 10000));
}

function normalized(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isExemptStaff(staff, policy) {
  return normalized(staff?.displayName) === normalized(policy?.exempt_staff_display_name)
    && normalized(staff?.businessRole) === normalized(policy?.exempt_staff_business_role);
}

function componentIsExempt(component, policy) {
  const staff = Array.isArray(component?.staff) ? component.staff : [];
  return staff.length > 0 && staff.every(person => isExemptStaff(person, policy));
}

function calculateDepositRequirement(components = [], policy = {}) {
  const depositBps = Number(policy.deposit_basis_points || policy.percentage_basis_points || 0);
  const items = (Array.isArray(components) ? components : []).map(component => {
    const amount = moneyFromCents(cents(component?.amount));
    const exempt = componentIsExempt(component, policy);
    return {
      appointmentId: Number(component?.appointmentId),
      eligibleAmount: exempt ? '0.00' : amount,
      requiredAmount: exempt ? '0.00' : basisPointsAmount(amount, depositBps),
      exemptReason: exempt ? 'marietjie' : null,
    };
  });
  const eligibleCents = items.reduce((sum, item) => sum + cents(item.eligibleAmount), 0);
  const requiredCents = items.reduce((sum, item) => sum + cents(item.requiredAmount), 0);
  return {
    eligibleAmountBase: moneyFromCents(eligibleCents),
    requiredAmount: moneyFromCents(requiredCents),
    exemptReason: items.length > 0 && items.every(item => item.exemptReason === 'marietjie') ? 'marietjie' : null,
    items,
  };
}

function retentionRule({
  outcome,
  appointmentStartsAt,
  eventAt = new Date(),
  fullReleaseNoticeHours = 48,
  partialNoticeHours = 24,
  partialRetentionBasisPoints = 5000,
  lateRetentionBasisPoints = 10000,
  noShowRetentionBasisPoints = 10000,
} = {}) {
  const start = new Date(appointmentStartsAt);
  const event = new Date(eventAt);
  const noticeHours = (start.getTime() - event.getTime()) / 3600000;
  if (outcome === 'no_show') {
    return { band: 'no_show', noticeHours, retentionBasisPoints: noShowRetentionBasisPoints };
  }
  if (noticeHours >= fullReleaseNoticeHours) {
    return { band: '48_plus', noticeHours, retentionBasisPoints: 0 };
  }
  if (noticeHours >= partialNoticeHours) {
    return { band: '24_to_48', noticeHours, retentionBasisPoints: partialRetentionBasisPoints };
  }
  return { band: 'under_24', noticeHours, retentionBasisPoints: lateRetentionBasisPoints };
}

module.exports = {
  cents,
  moneyFromCents,
  basisPointsAmount,
  isExemptStaff,
  componentIsExempt,
  calculateDepositRequirement,
  retentionRule,
};
