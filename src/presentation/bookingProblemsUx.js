'use strict';
const { escapeHtml: h } = require('./workspaceShell');
const LABELS = { needs_help:'Needs follow-up',retry_succeeded:'Same submission succeeded on retry',resolved:'Resolved by staff' };
function sast(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat('en-ZA', {
    timeZone:'Africa/Johannesburg',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,
  }).format(date) + ' SAST';
}
function bookingProblemsContent(model) {
  if (!model) return '';
  if (model.unavailable) return '<div class="booking-request" data-booking-problems><h3>Booking problems</h3><p role="status">Booking support links are temporarily unavailable. Please refresh later.</p></div>';
  const items = model.items || [];
  if (!items.length && !model.pendingCount && (!model.filter || model.filter === 'all')) return '';
  const filter = model.filter || 'all', offset = Number(model.offset) || 0;
  return `<div data-booking-problems data-offset="${offset}"><style>
    [data-booking-problems]{min-width:0;margin-top:12px}[data-booking-problems] .booking-request{min-width:0}
    [data-booking-problems] .request-actions{display:flex;flex-wrap:wrap;gap:8px}
    [data-booking-problems] button,[data-booking-problems] select,[data-booking-problems] a.button{min-height:44px}
    [data-booking-problems] select{max-width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--panel,#fffdf9);color:inherit}
    [data-booking-problems] code{overflow-wrap:anywhere;font-size:.8rem}
    [data-booking-problems] h3,[data-booking-problems] h4{margin:8px 0}
  </style><h3>Booking problems</h3><p class="request-note">${Number(model.pendingCount) || 0} need follow-up. Use the client’s existing contact actions for manual help. Nothing is sent automatically.</p>
  <label>Booking problem status <select data-booking-problems-filter>${[['all','All recent problems'],...Object.entries(LABELS)].map(([value,label])=>`<option value="${value}"${value===filter?' selected':''}>${h(label)}</option>`).join('')}</select></label>
  <p role="status" aria-live="polite" data-booking-problems-status></p>
  ${items.length ? items.map(item=>`<article class="booking-request" data-booking-problem="${h(item.reference)}" data-revision="${h(item.revision)}">
    <h4>${h(item.clientName || 'Client profile unavailable')}</h4>
    <p><strong>${h(LABELS[item.status] || 'Needs review')}</strong></p>
    <p class="request-note">Failed ${h(sast(item.firstFailedAt))}${Number(item.failureCount)>1?` · ${Number(item.failureCount)} failed attempts · Last ${h(sast(item.lastFailedAt))}`:''}</p>
    ${item.status==='retry_succeeded'?`<p class="request-note">The same client, attempt and submission returned a successful booking result at ${h(sast(item.recoveredAt))}.</p>`:item.status==='resolved'?`<p class="request-note">Staff marked this resolved at ${h(sast(item.resolvedAt))}.</p>`:'<p class="request-note">Check the client’s bookings before helping them submit again. A later appointment alone does not resolve this problem.</p>'}
    <p class="request-note">Reference: <code>${h(item.reference)}</code></p>
    <div class="request-actions"><a class="button" data-workspace-action="secondary" href="${h(item.openClientHref)}">Open client</a>
    ${item.canResolve?'<button type="button" data-workspace-action="secondary" data-booking-problem-resolve>Mark resolved</button>':''}</div>
  </article>`).join(''):'<p>No booking problems match this status.</p>'}
  <div class="request-actions">${offset?'<button type="button" data-workspace-action="secondary" data-booking-problems-page="previous">Previous</button>':''}${model.hasMore?'<button type="button" data-workspace-action="secondary" data-booking-problems-page="next">Next</button>':''}</div>
  <p class="request-note">Support links expire 14 days after the first failure.</p></div>`;
}
function bookingProblemsClientScript() {
  return `(function(){'use strict';
    async function refresh(root,offset){
      const filter=root.querySelector('[data-booking-problems-filter]')?.value||'all';
      const response=await fetch('/calendar/workspace/booking-problems?status='+encodeURIComponent(filter)+'&offset='+offset,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error(response.status===403?'Your client access has changed. Reload the dashboard.':'Booking problems could not be refreshed.');
      const html=await response.text();const host=document.createElement('div');host.innerHTML=html;
      const next=host.querySelector('[data-booking-problems]');
      if(next){root.replaceWith(next);const focus=next.querySelector('[data-booking-problems-filter]');focus?.focus();}
      else{root.replaceChildren();const p=document.createElement('p');p.textContent='No recent booking problems.';root.append(p);}
    }
    function error(root,e){const status=root.querySelector('[data-booking-problems-status]');if(status)status.textContent=e.message||'Please refresh and try again.';}
    document.addEventListener('change',async function(event){const select=event.target.closest('[data-booking-problems-filter]');if(!select)return;const root=select.closest('[data-booking-problems]');try{await refresh(root,0);}catch(e){error(root,e);}});
    document.addEventListener('click',async function(event){
      const button=event.target.closest('[data-booking-problem-resolve],[data-booking-problems-page]');if(!button)return;
      const root=button.closest('[data-booking-problems]');if(root.dataset.busy==='true')return;
      if(button.hasAttribute('data-booking-problem-resolve')){
        if(!window.ShilohConfirm||!await window.ShilohConfirm({title:'Mark booking problem resolved?',copy:'Confirm that manual follow-up is complete. This records your staff action; it does not change any booking or send a message.',action:'Mark resolved',cancel:'Keep open',danger:false}))return;
      }
      root.dataset.busy='true';button.disabled=true;
      try{
        if(button.hasAttribute('data-booking-problem-resolve')){
          const card=button.closest('[data-booking-problem]');
          const csrf=await fetch('/calendar/staff-auth/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:'{}'});
          const token=await csrf.json();if(!csrf.ok||!token.csrfToken)throw new Error('Your secure session has expired.');
          const response=await fetch('/calendar/workspace/booking-problems/'+encodeURIComponent(card.dataset.bookingProblem)+'/resolve',{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','x-shiloh-csrf-token':token.csrfToken},body:JSON.stringify({revision:card.dataset.revision})});
          if(!response.ok)throw new Error(response.status===409?'This problem changed. Refresh before resolving it.':'The problem could not be resolved. Refresh and check your client access.');
          location.reload();return;
        }else await refresh(root,Math.max(0,(Number(root.dataset.offset)||0)+(button.dataset.bookingProblemsPage==='next'?25:-25)));
      }catch(e){error(root,e);}finally{root.dataset.busy='false';button.disabled=false;}
    });
  })();`;
}
module.exports = { bookingProblemsContent, bookingProblemsClientScript, sast };
