const { escapeHtml } = require('./workspaceShell');

function money(value) {
  return `R${Number(value || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dateLabel(value) {
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00+02:00`));
}
function appointmentLink(id, label = `Appointment #${id}`) {
  return id ? `<a class="financial-link" href="/calendar/payments/appointments/${escapeHtml(id)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}
function financialStyles() {
  return `.financial-overview{margin-bottom:16px}.financial-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 10px}.financial-heading h2{margin:0;font-size:1.15rem}.financial-heading p,.financial-note{color:var(--muted);font-size:.76rem;line-height:1.5}.financial-heading p{margin:4px 0 0}.financial-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:12px}.financial-card{display:grid;gap:7px;padding:15px;background:var(--panel);border:1px solid var(--line);border-radius:14px;text-decoration:none;box-shadow:var(--shadow)}.financial-card span{font-size:.72rem;font-weight:800}.financial-card strong{font-size:1.35rem;color:var(--leaf-deep);overflow-wrap:anywhere}.financial-card small{font-size:.7rem;color:var(--muted);line-height:1.4}.financial-card:focus-visible{outline:2px solid var(--leaf);outline-offset:3px}.financial-alert{padding:11px;border-radius:10px;background:var(--danger-soft);color:var(--danger);font-size:.76rem;line-height:1.5}.financial-table{width:100%;border-collapse:collapse;font-size:.77rem}.financial-table th,.financial-table td{padding:11px 8px;text-align:right;border-bottom:1px solid var(--line);vertical-align:top}.financial-table th{color:var(--muted);font-size:.69rem}.financial-table th:first-child,.financial-table td:first-child{text-align:left}.financial-table th:first-child{min-width:110px}.financial-table td small{display:block;color:var(--muted);font-size:.68rem;line-height:1.5}.financial-link{display:inline-flex;align-items:center;min-height:44px;color:var(--leaf-deep);font-weight:750}.financial-bar{display:block;height:6px;margin-top:5px;background:var(--leaf-soft);border-radius:4px;overflow:hidden}.financial-bar span{display:block;height:100%;background:var(--leaf-deep)}.financial-table-scroll{overflow-x:auto}.financial-comparison{display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:12px;background:var(--leaf-soft);border-radius:11px;margin-bottom:12px}.financial-comparison strong{font-size:.95rem}.financial-comparison span{color:var(--muted);font-size:.75rem;line-height:1.45}.financial-unavailable{border:1px dashed var(--line-strong);padding:12px;border-radius:12px;font-size:.76rem;color:var(--muted);line-height:1.5}@media(max-width:700px){.financial-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.financial-heading{align-items:start;flex-direction:column}.financial-card{padding:12px}.financial-card strong{font-size:1.2rem}.financial-table{min-width:470px}.financial-table-scroll{max-width:100%}.financial-table th,.financial-table td{padding:9px 6px}}`;
}

function panel(id, heading, copy, contents) {
  return `<details class="panel" id="${id}" data-report-section><summary class="panel-heading"><div><span class="eyebrow">Finances</span><h2>${heading}</h2><p>${copy}</p></div></summary><div class="panel-body">${contents}</div></details>`;
}
function table(headings, rows) {
  return `<div class="financial-table-scroll"><table class="financial-table"><thead><tr>${headings.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headings.length}">No records for this period.</td></tr>`}</tbody></table></div>`;
}

function financialOverview(model) {
  const finance = model.financial;
  if (!finance) return '';
  const current = finance.current;
  const commission = (model.staffEarnings?.staff || []).reduce((sum, row) => sum + row.commission, 0);
  const review = (model.staffEarnings?.staff || []).reduce((sum, row) => sum + row.reviewCount, 0);
  const params = new URLSearchParams({ from: model.period.startKey, to: model.period.endInclusiveKey });
  const cards = [
    ['Completed treatment value', money(current.treatmentValue), `${current.completedCount} completed visits · before Rewards and welcome-voucher credits.`, '#financial-treatments'],
    ['Money received', money(current.received), `Includes ${money(current.voucherReceipts)} gift-voucher sales. Refunds ${money(current.refunded)} · net ${money(current.netReceived)}.`, '#financial-receipts'],
    ['Booking balances to collect', money(finance.outstanding), 'Current balances on bookings with completed visits in this period. Linked bookings counted once.', '#financial-balances'],
    ['Calculated commission', money(commission), `${model.selectedStaffId ? 'Selected practitioner' : 'Whole team'} · ${review ? `${review} entries need review. ` : ''}Payment of commission is not tracked yet.`, '#staff-earnings'],
  ];
  const comparison = finance.comparison;
  const comparisonCopy = comparison.incomplete ? 'Some treatment prices need review in one or both periods.'
    : comparison.percent == null ? 'No percentage comparison: the earlier period has no recorded treatment value.'
      : `${comparison.percent > 0 ? '+' : ''}${comparison.percent}% compared with the earlier period.`;
  return `<section class="financial-overview" aria-label="Financial overview" data-financial-reports>
    <div class="financial-heading"><div><h2>Financial overview</h2><p>Clinic totals · ${model.selectedStaffId ? 'The team filter applies to commission and operational reports below. ' : ''}South African dates and Rand.</p></div><a class="button" href="/calendar/reports/financial.csv?${escapeHtml(params.toString())}">Export finances</a></div>
    <div class="financial-cards">${cards.map(([label, value, copy, href]) => `<a class="financial-card jump-link" href="${href}"><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(copy)}</small></a>`).join('')}</div>
    <div class="financial-comparison"><strong>${escapeHtml(money(finance.previous.treatmentValue))} → ${escapeHtml(money(current.treatmentValue))}</strong><span>${escapeHtml(comparisonCopy)}<br>${escapeHtml(dateLabel(finance.period.previousStartKey))}–${escapeHtml(dateLabel(new Date(new Date(finance.period.previousTo).getTime() - 1).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })))} versus the selected period.</span></div>
    ${current.unpricedCount || finance.balanceReviewCount ? `<p class="financial-alert">${current.unpricedCount} completed treatment prices and ${finance.balanceReviewCount} booking balances need review. Missing amounts are excluded from totals.</p>` : ''}
    <p class="financial-note">Treatment value follows the appointment date. Receipts and refunds follow when they were recorded, including deposits for future visits. These figures are separate; adding them together would count money twice.</p>
    <div class="financial-unavailable">Expenses and saved cash-up closes are not recorded here yet. Profit, commission paid, and commission still payable will appear once those records are available.</div>
  </section>`;
}

function financialSections(finance) {
  if (!finance) return '';
  const max = Math.max(1, ...finance.days.map(day => day.treatmentValue));
  const dailyRows = finance.days.map(day => `<tr><th scope="row">${escapeHtml(dateLabel(day.date))}</th><td>${escapeHtml(money(day.treatmentValue))}<span class="financial-bar" aria-hidden="true"><span style="width:${Math.round(day.treatmentValue / max * 100)}%"></span></span></td><td>${escapeHtml(money(day.received))}</td><td>${escapeHtml(money(day.refunded))}</td><td>${escapeHtml(money(day.netReceived))}</td></tr>`).join('');
  const daily = panel('financial-daily', 'Daily financial trend', 'Completed treatment value and recorded receipts side by side.', table(['Day', 'Treatment value', 'Received', 'Refunds', 'Net received'], dailyRows));
  const methods = finance.methods.map(row => `<tr><th scope="row">${escapeHtml(row.name)}</th><td>${escapeHtml(money(row.received))}</td><td>${escapeHtml(money(row.refunded))}</td><td>${escapeHtml(money(row.netReceived))}</td></tr>`).join('');
  const receipts = finance.receipts.map(row => `<tr><td>${escapeHtml(dateLabel(row.date))}<small>${row.source === 'voucher' ? `Gift-voucher order #${escapeHtml(row.voucherOrderId)}` : appointmentLink(row.appointmentId)}${row.groupId ? ` · Linked booking #${escapeHtml(row.groupId)}` : ''}</small></td><td>${escapeHtml(row.method)}</td><td>${row.type === 'refund' ? 'Refund' : 'Payment'}</td><td>${escapeHtml(money(row.amount))}</td></tr>`).join('');
  const cash = panel('financial-receipts', 'Receipts & cash-up summary', 'Booking payments and gift-voucher sales by method. Cash is recorded movement, not the drawer balance. Refunds cover the booking ledger.', table(['Method', 'Received', 'Refunds', 'Net received'], methods) + '<h3>Payment history</h3>' + table(['Recorded date / booking', 'Method', 'Type', 'Amount'], receipts));
  const balanceRows = finance.unpaid.map(row => `<tr><td>${appointmentLink(row.appointmentId, row.groupId ? `Linked booking #${row.groupId}` : `Appointment #${row.appointmentId}`)}<small>${row.mixedStatus ? 'Includes other visits with a different status; review the whole booking.' : 'Completed booking'} · ${escapeHtml(dateLabel(row.date))}</small></td><td>${escapeHtml(money(row.amountDue))}</td><td>${escapeHtml(money(row.netPaid))}</td><td>${escapeHtml(money(row.credits))}</td><td>${escapeHtml(money(row.outstanding))}</td></tr>`).join('');
  const balance = panel('financial-balances', 'Balances to collect', 'Current unpaid booking balances, after refunds and applied Rewards or welcome-voucher credits. Linked booking payments are not split across visits. Gift-voucher redemptions are recorded separately and have no booking allocation yet; review those balances before collection.', table(['Booking', 'Booking value', 'Net received', 'Credits applied', 'Outstanding'], balanceRows));
  const serviceRows = finance.services.map(row => `<tr><td>${escapeHtml(row.name)}${row.reviewCount ? `<small>${row.reviewCount} prices need review</small>` : ''}</td><td>${row.count}</td><td>${escapeHtml(money(row.value))}</td></tr>`).join('');
  const treatmentRows = finance.treatments.map(row => `<tr><td><a class="financial-link" href="/calendar/read-only?view=day&amp;date=${escapeHtml(row.date)}&amp;appointment=${escapeHtml(row.appointmentId)}">Appointment #${escapeHtml(row.appointmentId)}</a><small>${escapeHtml(dateLabel(row.date))}${row.groupId ? ' · Recorded linked-booking allocation' : ''}</small></td><td>${escapeHtml(row.treatment)}</td><td>${row.value == null ? 'Price needs review' : escapeHtml(money(row.value))}</td></tr>`).join('');
  const treatments = panel('financial-treatments', 'Completed treatments & value', 'Only completed visits. Combined treatments stay together; individual service values are not guessed.', table(['Treatment / combination', 'Completed', 'Treatment value'], serviceRows) + '<h3>Completed visit details</h3>' + table(['Appointment', 'Treatment', 'Value'], treatmentRows));
  const vouchers = finance.vouchers || {};
  const voucherSection = panel('financial-vouchers', 'Gift-voucher value', 'Voucher sales are included in receipts. Redemptions use prepaid value and never create another cash receipt.', table(['Measure', 'Value'],
    `<tr><th scope="row">Vouchers issued in period</th><td>${escapeHtml(vouchers.issued_count || 0)}</td></tr><tr><th scope="row">Value redeemed in period</th><td>${escapeHtml(money(vouchers.redeemed_value))}</td></tr><tr><th scope="row">Current available value</th><td>${escapeHtml(money(vouchers.available_balance))}</td></tr><tr><th scope="row">Expired unused value</th><td>${escapeHtml(money(vouchers.expired_balance))}</td></tr>`));
  return daily + cash + balance + treatments + voucherSection;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function financialCsv(finance) {
  const rows = [
    ['Shiloh financial report', finance.period.startKey, finance.period.endInclusiveKey, 'Africa/Johannesburg', 'ZAR'],
    ['Completed treatment value', finance.current.treatmentValue.toFixed(2), 'Before Rewards / welcome-voucher credits'],
    ['Received', finance.current.received.toFixed(2)], ['Refunds', finance.current.refunded.toFixed(2)],
    ['Net received', finance.current.netReceived.toFixed(2)], ['Current booking balances to collect', finance.outstanding.toFixed(2)],
    ['Missing treatment prices', finance.current.unpricedCount], ['Balances needing review', finance.balanceReviewCount], [],
    ['Day', 'Treatment value', 'Received', 'Refunds', 'Net received'],
    ...finance.days.map(day => [day.date, day.treatmentValue.toFixed(2), day.received.toFixed(2), day.refunded.toFixed(2), day.netReceived.toFixed(2)]), [],
    ['Recorded date', 'Source', 'Ledger ID', 'Appointment ID', 'Linked booking ID', 'Voucher order ID', 'Method', 'Type', 'Amount'],
    ...finance.receipts.map(row => [row.date, row.source, row.id, row.appointmentId, row.groupId, row.voucherOrderId, row.method, row.type, row.amount.toFixed(2)]), [],
    ['Appointment ID', 'Linked booking ID', 'Date', 'Treatment', 'Completed value'],
    ...finance.treatments.map(row => [row.appointmentId, row.groupId, row.date, row.treatment, row.value == null ? 'Review price' : row.value.toFixed(2)]), [],
    ['Appointment ID', 'Linked booking ID', 'Booking value', 'Net received', 'Credits', 'Outstanding', 'Other visit statuses'],
    ...finance.unpaid.map(row => [row.appointmentId, row.groupId, row.amountDue.toFixed(2), row.netPaid.toFixed(2), row.credits.toFixed(2), row.outstanding.toFixed(2), row.mixedStatus ? 'Review whole booking' : 'Completed']),
  ];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
module.exports = { financialStyles, financialOverview, financialSections, financialCsv, csvCell };
