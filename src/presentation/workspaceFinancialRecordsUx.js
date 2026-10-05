const { escapeHtml } = require('./workspaceShell');
const { CATEGORIES, EXPENSE_METHODS } = require('../domain/workspaceFinancialRecords');
const money = value => `R${Number(value || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = (id, label, attrs) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" ${attrs}></div>`;
function recordsStyles() {
  return `.finance-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}.finance-form .wide{grid-column:1/-1}.finance-form input,.finance-form select,.finance-form textarea{width:100%;min-height:44px;box-sizing:border-box;border:1px solid var(--line-strong);border-radius:9px;padding:10px;background:var(--panel);color:var(--ink);font:inherit}.finance-form textarea{min-height:80px;resize:vertical}.finance-form label{font-size:.76rem;font-weight:750}.finance-status{grid-column:1/-1;font-size:.8rem;line-height:1.5;white-space:pre-line}.finance-status:empty{display:none}.finance-entry{border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0;overflow-wrap:anywhere}.finance-entry h3{margin:0 0 8px;font-size:.9rem}.finance-entry p{font-size:.77rem;line-height:1.5}.finance-void{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.finance-void .field{flex:1;min-width:150px}.finance-void input{min-height:44px;padding:10px;border:1px solid var(--line-strong);border-radius:9px;box-sizing:border-box;width:100%}.finance-void label{font-size:.75rem}.finance-source{padding:12px;background:var(--leaf-soft);border-radius:10px;font-size:.8rem;line-height:1.6;white-space:pre-line}.finance-source:empty{display:none}.finance-form button:disabled{opacity:.65}.finance-form input:focus-visible,.finance-form textarea:focus-visible,.finance-void input:focus-visible{outline:2px solid var(--leaf);outline-offset:2px}@media(max-width:700px){.finance-form{grid-template-columns:minmax(0,1fr)}.finance-void{display:grid;grid-template-columns:minmax(0,1fr)}}`;
}
function recordSections(records, period, csrfToken = '') {
  if (!records) return '';
  const date = period.endInclusiveKey > records.today ? records.today : period.endInclusiveKey;
  const categories = Object.entries(CATEGORIES).map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join('');
  const methods = Object.entries(EXPENSE_METHODS).map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join('');
  const expenses = records.rows.map(row => `<article class="finance-entry"><h3>${escapeHtml(row.description)} · ${escapeHtml(money(row.amount))}</h3><p>${escapeHtml(row.paid_on)} · ${escapeHtml(CATEGORIES[row.category])} · ${escapeHtml(EXPENSE_METHODS[row.method])}<br>Saved by ${escapeHtml(row.created_by)}${row.reference ? ` · Reference: ${escapeHtml(row.reference)}` : ''}</p>${row.voided_at ? `<p>Voided by ${escapeHtml(row.voided_by)}: ${escapeHtml(row.void_reason)}</p>` : `<details><summary>Correct this expense</summary><p>Void the incorrect entry, then record the replacement. The original stays in history.</p><form class="finance-void" data-expense-void="${escapeHtml(row.id)}" data-csrf="${escapeHtml(csrfToken)}"><div class="field"><label for="void-${escapeHtml(row.id)}">Reason for correction</label><input id="void-${escapeHtml(row.id)}" name="reason" maxlength="200" required></div><button class="button" type="submit">Void expense</button><p class="finance-status" role="status"></p></form></details>`}</article>`).join('');
  const breakdown = records.categories.filter(row => row.amount > 0).map(row => `${escapeHtml(row.label)}: ${escapeHtml(money(row.amount))}`).join(' · ');
  const closes = records.closes.map(row => `<article class="finance-entry"><h3>${escapeHtml(row.business_date)} · Close ${escapeHtml(row.revision)}</h3><p>Expected ${escapeHtml(money(row.expected_cash))} · Counted ${escapeHtml(money(row.counted_cash))} · Difference ${escapeHtml(money(row.difference))}<br>Opening float ${escapeHtml(money(row.opening_float))} · Cash added ${escapeHtml(money(row.cash_added))} · Cash removed ${escapeHtml(money(row.cash_removed))}<br>Cash expenses at close ${escapeHtml(money(row.snapshot?.cashExpenses))} · Saved by ${escapeHtml(row.created_by)} at ${escapeHtml(new Date(row.created_at).toLocaleString('en-ZA',{ timeZone:'Africa/Johannesburg' }))} SAST</p>${row.note ? `<p>${escapeHtml(row.note)}</p>` : ''}<details><summary>Recorded payments at this close</summary><p>${(row.snapshot?.methods || []).map(method => `${escapeHtml(method.name)}: received ${escapeHtml(money(method.received))} · refunds ${escapeHtml(money(method.refunded))} · net ${escapeHtml(money(method.netReceived))}`).join('<br>') || 'No method summary available.'}</p></details></article>`).join('');
  return `<details class="panel" id="financial-expenses" data-report-section><summary class="panel-heading"><div><span class="eyebrow">Finances</span><h2>Expenses</h2><p>Record money already paid by the clinic, including wages or commission actually paid.</p></div></summary><div class="panel-body"><p><strong>${escapeHtml(money(records.total))}</strong> recorded expenses · ${records.count} active entries in this period.</p><p class="financial-note">${breakdown || 'No paid expenses recorded for this period.'}<br>These are the entries you have recorded; the total does not confirm that every expense has been captured. No tax or profit calculation is applied.</p><form class="finance-form" data-expense-form data-csrf="${escapeHtml(csrfToken)}">
    ${field('expense-date','Paid on',`name="paidOn" type="date" value="${escapeHtml(date)}" max="${escapeHtml(records.today)}" min="2000-01-01" required`)}
    <div class="field"><label for="expense-category">Category</label><select id="expense-category" name="category" required><option value="">Choose a category</option>${categories}</select></div>
    ${field('expense-description','Description','name="description" maxlength="200" required')}
    ${field('expense-amount','Amount paid (R)','name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required')}
    <div class="field"><label for="expense-method">Paid from</label><select id="expense-method" name="method" required><option value="">Choose a payment method</option>${methods}</select></div>
    ${field('expense-reference','Receipt / reference (optional)','name="reference" maxlength="120"')}
    <p class="financial-note wide">Cash expenses are subtracted from the cash drawer for the paid date. Record only clinic spending here. Banking cash or an owner withdrawal belongs under Cash removed in the daily cash-up.</p>
    <button class="button primary" type="submit">Save expense</button><p class="finance-status" role="status"></p></form>
    <h3>Expense history</h3>${expenses || '<p class="financial-note">No expense entries in this period.</p>'}</div></details>
    <details class="panel" id="financial-cashup" data-report-section><summary class="panel-heading"><div><span class="eyebrow">Finances</span><h2>Daily cash-up</h2><p>Clinic-wide recorded payments, counted cash and a dated close.</p></div></summary><div class="panel-body"><p class="financial-note">Expected cash = opening float + cash payments − cash refunds − cash expenses + cash added − cash removed. Count all clinic drawers included in these totals, including the float. Card, EFT and Ozow are shown as recorded totals for comparison with your provider statements; saving a close does not confirm bank settlement.</p><form class="finance-form" data-cashup-form data-csrf="${escapeHtml(csrfToken)}">
    ${field('cashup-date','Cash-up date',`name="date" type="date" value="${escapeHtml(date)}" max="${escapeHtml(records.today)}" min="2000-01-01" required`)}
    <button class="button" type="button" data-cashup-review>Review this day</button><div class="finance-source wide" data-cashup-source role="status"></div>
    ${field('cashup-opening','Opening float (R)','name="openingFloat" type="number" min="0" max="9999999999.99" step="0.01" required')}
    ${field('cashup-counted','Cash counted, including float (R)','name="countedCash" type="number" min="0" max="9999999999.99" step="0.01" required')}
    ${field('cashup-added','Extra cash added (R)','name="cashAdded" type="number" min="0" max="9999999999.99" step="0.01" value="0" required')}
    ${field('cashup-removed','Cash removed / banked (R)','name="cashRemoved" type="number" min="0" max="9999999999.99" step="0.01" value="0" required')}
    <div class="field wide"><label for="cashup-note">Note / reason for a difference or revised close</label><textarea id="cashup-note" name="note" maxlength="500"></textarea></div>
    <p class="finance-source wide" data-cashup-calculation></p><button class="button primary" type="submit" disabled>Save daily close</button><p class="finance-status" role="status"></p></form><p class="financial-note">Saved closes retain the figures used at the time. Review the day to check for later entries. A revised close preserves every earlier version. Forms need JavaScript enabled.</p><h3>Saved closes in this period</h3>${closes || '<p class="financial-note">No daily closes saved for this period.</p>'}</div></details>`;
}
function recordsClientScript() {
  return `(() => {
  const rand = value => 'R' + Number(value).toLocaleString('en-ZA', {minimumFractionDigits:2,maximumFractionDigits:2});
  const operation = () => crypto.randomUUID();
  const request = async (path, form, body) => {
    const response = await fetch('/calendar/reports/' + path, { method:'POST', headers:{'Content-Type':'application/json','X-Shiloh-CSRF-Token':form.dataset.csrf}, body:JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to save. Refresh and try again.');
    return result;
  };
  const refresh = hash => { const url = new URL(location.href); url.hash = hash; location.assign(url.href); location.reload(); };
  document.querySelectorAll('[data-expense-form],[data-expense-void]').forEach(form => {
    const operationId = operation();
    form.addEventListener('submit', async event => {
      event.preventDefault(); const status = form.querySelector('[role=status]'), button = form.querySelector('button'); button.disabled = true; status.textContent = 'Saving…';
      try { const body = Object.fromEntries(new FormData(form));
        await request(form.hasAttribute('data-expense-form') ? 'expenses' : 'expenses/' + form.dataset.expenseVoid + '/void',form,{...body,operationId});
        status.textContent = 'Saved.'; refresh('financial-expenses');
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    });
  });
  const form = document.querySelector('[data-cashup-form]'); if (!form) return;
  let source = null, operationId = operation();
  const status = form.querySelector('.finance-status'), sourceLabel = form.querySelector('[data-cashup-source]'), calculationLabel = form.querySelector('[data-cashup-calculation]'), save = form.querySelector('[type=submit]'), review = form.querySelector('[data-cashup-review]');
  const calculate = () => {
    if (!source) { calculationLabel.textContent = ''; return; }
    const values = Object.fromEntries(new FormData(form));
    if (['openingFloat','countedCash','cashAdded','cashRemoved'].some(key => values[key] === '' || !Number.isFinite(Number(values[key])))) { calculationLabel.textContent = 'Enter the float and counted cash to see your difference.'; return; }
    const cash = source.methods.find(row => row.key === 'cash');
    const expected = Math.round(Number(values.openingFloat)*100) + Math.round(cash.netReceived*100) - Math.round(source.cashExpenses*100) + Math.round(Number(values.cashAdded)*100) - Math.round(Number(values.cashRemoved)*100);
    calculationLabel.textContent = 'Expected cash: ' + rand(expected/100) + '\\nDifference: ' + rand((Math.round(Number(values.countedCash)*100)-expected)/100);
  };
  form.addEventListener('input', event => { if (event.target.name === 'date') { source=null; save.disabled=true; sourceLabel.textContent='Review the selected day before saving.'; } calculate(); });
  review.addEventListener('click', async () => {
    source = null; save.disabled = true; review.disabled = true; status.textContent = 'Loading the day…';
    const date = form.elements.date.value;
    try {
      const response = await fetch('/calendar/reports/cashup-preview?date=' + encodeURIComponent(date)); const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to review this day.');
      if (form.elements.date.value !== date) throw new Error('The date changed. Review the selected day again.');
      source=result; operationId=operation();
      sourceLabel.textContent = date + '\\n' + result.methods.map(row => row.name + ': received ' + rand(row.received) + ', refunds ' + rand(row.refunded) + ', net ' + rand(row.netReceived)).join('\\n') + '\\nCash expenses: ' + rand(result.cashExpenses) + '\\n' + (result.revision ? 'Latest saved close: ' + result.revision + (result.changedSinceClose ? ' · Entries changed since this close. Review and save a revised close.' : ' · Recorded entries match this close.') : 'No close saved for this day.');
      save.disabled=false; status.textContent='Day reviewed. Enter your cash count and save.'; calculate();
    } catch (error) { status.textContent=error.message; } finally { review.disabled=false; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!source) return; save.disabled=true; review.disabled=true; status.textContent='Saving…';
    try { const body=Object.fromEntries(new FormData(form));
      await request('cashup-closes',form,{...body,operationId,fingerprint:source.fingerprint,revision:source.revision}); status.textContent='Daily close saved.'; refresh('financial-cashup');
    } catch (error) { status.textContent=error.message; save.disabled=false; } finally { review.disabled=false; }
  });
})();`;
}
module.exports = { recordsStyles, recordSections, recordsClientScript };
