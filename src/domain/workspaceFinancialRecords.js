const CATEGORIES = { rent: 'Rent', utilities: 'Water & electricity', supplies: 'Treatment supplies', laundry: 'Laundry & cleaning', equipment: 'Equipment', software: 'Software & subscriptions', marketing: 'Marketing', wages: 'Wages & salaries', commission: 'Commission payment', other: 'Other' };
const EXPENSE_METHODS = { cash: 'Cash', card_machine: 'Card', manual_eft: 'EFT / bank' };
function error(message, httpStatus = 400) { return Object.assign(new Error(message), { httpStatus }); }
function moneyCents(value, { positive = false } = {}) {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value)) || !Number.isSafeInteger(Math.round(Number(value) * 100))
    || (positive && Number(value) <= 0)) throw error('Enter a valid Rand amount with at most two decimal places.');
  return Math.round(Number(value) * 100);
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw error('Check the description, reference or note.');
  return value.trim();
}
function day(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || String(value) < '2000-01-01' || String(value) > today
    || !Number.isFinite(new Date(`${value}T12:00:00Z`).getTime())
    || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw error('Choose a valid date up to today.');
  return value;
}
function operation(value) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value))) throw error('Refresh the page and try again.');
  return String(value).toLowerCase();
}
function summarizeExpenses(rows = []) {
  const active = rows.filter(row => !row.voided_at);
  const total = active.reduce((sum, row) => sum + moneyCents(row.amount, { positive: true }), 0);
  return { rows, count: active.length, total: total / 100,
    categories: Object.entries(CATEGORIES).map(([key, label]) => ({ key, label,
      amount: active.filter(row => row.category === key).reduce((sum, row) => sum + moneyCents(row.amount), 0) / 100 })),
  };
}
function cashCalculation(source, input) {
  const opening = moneyCents(input.openingFloat), added = moneyCents(input.cashAdded), removed = moneyCents(input.cashRemoved), counted = moneyCents(input.countedCash);
  const cash = source.methods.find(row => row.key === 'cash');
  // Net can be negative on a refund-only day. Expenses are paid, not forecasts.
  const expected = opening + Math.round(Number(cash?.netReceived || 0) * 100) - Math.round(source.cashExpenses * 100) + added - removed;
  if (Math.abs(expected) >= 1e12 || Math.abs(counted - expected) >= 1e12) throw error('The combined cash amounts exceed the supported range.');
  return { openingFloat: opening / 100, cashAdded: added / 100, cashRemoved: removed / 100,
    countedCash: counted / 100, expectedCash: expected / 100, difference: (counted - expected) / 100 };
}
module.exports = { CATEGORIES, EXPENSE_METHODS, error, moneyCents, text, day, operation, summarizeExpenses, cashCalculation };
