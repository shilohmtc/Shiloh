function clinicDate(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

const METHODS = { cash: 'Cash', card_machine: 'Card machine', manual_eft: 'EFT', ozow: 'Ozow' };
const cents = value => value == null ? null : Math.round(Number(value) * 100);
const rand = value => value / 100;

function inRange(value, from, to) {
  const time = new Date(value).getTime();
  return time >= new Date(from).getTime() && time < new Date(to).getTime();
}

function summarizeFinancials({ period, treatments = [], receipts = [], balances = [] }) {
  const days = new Map();
  for (let index = 0; index < period.dayCount; index += 1) {
    const date = clinicDate(new Date(new Date(period.from).getTime() + index * 86400000));
    days.set(date, { date, treatmentValue: 0, received: 0, refunded: 0 });
  }
  const current = { treatmentValue: 0, received: 0, refunded: 0, voucherReceipts: 0, completedCount: 0, unpricedCount: 0 };
  const previous = { ...current };
  const treatmentDetails = [];
  const services = new Map();
  for (const item of treatments) {
    const isCurrent = inRange(item.starts_at, period.from, period.to);
    if (!isCurrent && !inRange(item.starts_at, period.previousFrom, period.previousTo)) continue;
    const totals = isCurrent ? current : previous;
    const value = cents(item.value);
    const valid = Number.isSafeInteger(value) && value >= 0;
    totals.completedCount += 1;
    if (valid) totals.treatmentValue += value;
    else totals.unpricedCount += 1;
    if (!isCurrent) continue;
    if (valid) days.get(clinicDate(item.starts_at)).treatmentValue += value;
    treatmentDetails.push({ appointmentId: Number(item.id), date: clinicDate(item.starts_at),
      treatment: item.treatment, value: valid ? rand(value) : null, groupId: item.group_id || null });
    const name = item.treatment || 'Treatment';
    const service = services.get(name) || { name, count: 0, value: 0, reviewCount: 0 };
    service.count += 1;
    if (valid) service.value += value;
    else service.reviewCount += 1;
    services.set(name, service);
  }
  const methods = new Map(Object.entries(METHODS).map(([key, name]) => [key, { key, name, received: 0, refunded: 0 }]));
  const receiptDetails = [];
  for (const item of receipts) {
    const isCurrent = inRange(item.created_at, period.from, period.to);
    if (!isCurrent && !inRange(item.created_at, period.previousFrom, period.previousTo)) continue;
    const amount = cents(item.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !['payment', 'refund'].includes(item.entry_type)
      || !methods.has(item.method)) throw new Error('Invalid payment ledger evidence');
    const field = item.entry_type === 'payment' ? 'received' : 'refunded';
    (isCurrent ? current : previous)[field] += amount;
    if (item.source === 'voucher') (isCurrent ? current : previous).voucherReceipts += amount;
    if (!isCurrent) continue;
    methods.get(item.method)[field] += amount;
    days.get(clinicDate(item.created_at))[field] += amount;
    receiptDetails.push({ id: Number(item.id), date: clinicDate(item.created_at), type: item.entry_type,
      method: METHODS[item.method], amount: rand(amount), appointmentId: Number(item.appointment_id) || null,
      groupId: item.group_id || null, source: item.source || 'booking', voucherOrderId: item.voucher_order_id || null });
  }
  const unpaid = [];
  let balanceReviewCount = 0;
  for (const row of balances) {
    const due = cents(row.amount_due), paid = cents(row.net_paid), credits = cents(row.credits);
    if (![due, paid, credits].every(Number.isSafeInteger) || due < 0 || credits < 0) {
      balanceReviewCount += 1;
      continue;
    }
    const outstanding = Math.max(0, due - paid - credits);
    if (!outstanding) continue;
    unpaid.push({ appointmentId: Number(row.appointment_id), groupId: row.group_id || null,
      date: clinicDate(row.starts_at), amountDue: rand(due), netPaid: rand(paid), credits: rand(credits),
      outstanding: rand(outstanding), mixedStatus: row.mixed_status === true });
  }
  const convertTotals = totals => ({ ...totals, treatmentValue: rand(totals.treatmentValue),
    received: rand(totals.received), refunded: rand(totals.refunded), voucherReceipts: rand(totals.voucherReceipts), netReceived: rand(totals.received - totals.refunded) });
  const delta = current.treatmentValue - previous.treatmentValue;
  return {
    current: convertTotals(current), previous: convertTotals(previous),
    comparison: { delta: rand(delta), percent: previous.treatmentValue > 0 ? Math.round(delta / previous.treatmentValue * 100) : null,
      incomplete: current.unpricedCount > 0 || previous.unpricedCount > 0 },
    days: [...days.values()].map(day => ({ ...day, treatmentValue: rand(day.treatmentValue), received: rand(day.received),
      refunded: rand(day.refunded), netReceived: rand(day.received - day.refunded) })),
    methods: [...methods.values()].map(method => ({ ...method, received: rand(method.received),
      refunded: rand(method.refunded), netReceived: rand(method.received - method.refunded) })),
    treatments: treatmentDetails, receipts: receiptDetails,
    services: [...services.values()].map(row => ({ ...row, value: rand(row.value) })).sort((a, b) => b.value - a.value),
    unpaid, outstanding: rand(unpaid.reduce((sum, row) => sum + cents(row.outstanding), 0)), balanceReviewCount,
  };
}

module.exports = { METHODS, summarizeFinancials };
