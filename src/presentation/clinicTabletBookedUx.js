'use strict';
const { shell } = require('./clinicIpadCheckinUx');
const { renderClientConsultationFormPage:renderForm } = require('./clientConsultationFormUx');
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const BASE='/check-in/booked';
function tabletBookedPage({state='start',csrf='',error='',visits=[],position,total,assignmentId,model}={}) {
  const hidden=`<input type="hidden" name="tablet_csrf" value="${esc(csrf)}">`;
  const cancel=`<form method="post" action="${BASE}/cancel">${hidden}<button class="button secondary" type="submit">Clear and start again</button></form>`;
  const script=`<script src="${BASE}/reset.js" defer></script>`;
  if(state==='form') {
    let markup=renderForm({...model,accessToken:'tablet',myShilohReturnProof:null,submissionProof:csrf});
    // No canonical bearer form token is ever rendered or placed in history.
    markup=markup.replace(/action="\/forms\/f\/tablet"/,`action="${BASE}/form"`)
      .replace(/<script src="\/forms\/assets\/client-consultation[^>]+><\/script>/,'')
      .replace('data-client-consultation-form novalidate',`data-client-consultation-form autocomplete="off"`)
      .replace('<form method="post"',`<p role="status">Form ${Number(position)} of ${Number(total)}</p>${error?`<p role="alert">${esc(error)}</p>`:''}<form method="post"`)
      .replace('<div class="submit-wrap">',`${hidden}<input type="hidden" name="assignment_id" value="${esc(assignmentId)}"><div class="submit-wrap">`)
      .replace('</main>',`${cancel}</main>`)
      .replace('</head>','<style>form[action="/check-in/booked/cancel"]{margin-top:24px}form[action="/check-in/booked/cancel"] button{font:inherit;min-height:48px;padding:12px 18px;border:1px solid #b8c8bd;border-radius:12px;background:#fffdf8;color:#253c32;cursor:pointer}form[action="/check-in/booked/cancel"] button:focus-visible{outline:3px solid #3b654c;outline-offset:3px}</style></head>')
      .replace('</body>',`${script}</body>`);
    markup=markup.replace('Please do not share this link. It is unique to this appointment and expires automatically.','This tablet opens only the selected visit’s form. Your information clears when you finish.');
    return markup.replace(/autocomplete="[^"]*"/g,'autocomplete="off"');
  }
  const problem=error?`<p class="error" role="alert">${esc(error)}</p>`:'';
  let content;
  if(state==='code')content=`<h1>Check WhatsApp</h1><p>If a code can be sent, it will arrive in WhatsApp on your phone. Enter it here. This gives temporary access to your visit’s forms only.</p>${problem}<form method="post" action="${BASE}/verify">${hidden}<div class="field"><label for="code">WhatsApp code</label><input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></div><button class="button">Verify code</button></form><p>If the code does not arrive, please ask Reception for help.</p>${cancel}`;
  else if(state==='choose')content=`<h1>Choose your visit</h1><p>Please select the appointment you are here for. We will open its required forms.</p>${problem}<form method="post" action="${BASE}/choose">${hidden}<fieldset><legend>Your appointments</legend>${visits.map(v=>`<p><label><input style="width:auto;min-height:24px" type="radio" name="appointment_id" value="${esc(v.id)}" required> ${esc(v.label)}</label></p>`).join('')}</fieldset><button class="button">Continue to forms</button></form>${cancel}`;
  else if(state==='finished')content='<h1>You’re all set</h1><p>Shiloh confirms there are no outstanding required forms for this visit. Your information has been cleared from this tablet.</p><a class="button" href="/check-in/booked/">Ready for the next client</a>';
  else if(state==='help')content=`<h1>Reception can help</h1><p>We could not safely open a visit’s forms here. Please ask Reception to check the booking or prepare the existing tablet handover.</p>${problem}${cancel}<p><a href="/check-in/">Use the staff-assisted handover</a></p>`;
  else content=`<h1>Welcome to Shiloh</h1><p>Here for a booked treatment? Enter the mobile number recorded for your booking.</p>${problem}<form method="post" action="${BASE}/start">${hidden}<div class="field"><label for="mobile">Mobile number</label><input id="mobile" name="mobile" type="tel" inputmode="tel" maxlength="30" autocomplete="off" required></div><button class="button">Send WhatsApp code</button></form><p>Sharing a number, or need help? Please ask Reception to prepare your form.</p><a href="/check-in/">Use the staff-assisted handover</a>`;
  return shell(`<div data-tablet-stage="${esc(state)}" data-tablet-csrf="${esc(csrf)}">${content}</div><p class="privacy">This is a shared tablet. Temporary access ends after inactivity. Your My Shiloh account stays separate.</p>${script}`);
}
function tabletBookedResetScript(){return `(()=>{'use strict';const base='/check-in/booked';let activity=Date.now();const csrf=document.querySelector('[name="tablet_csrf"]')?.value||document.querySelector('[data-tablet-csrf]')?.dataset.tabletCsrf;let cleared=false;function erase(){document.querySelector('main')?.replaceChildren();document.querySelector('.wrap')?.replaceChildren();}function reset(){if(cleared)return;cleared=true;erase();location.replace(base+'/');}document.addEventListener('submit',event=>{const form=event.target;if(form.dataset.tabletSubmitting==='true'){event.preventDefault();return;}form.dataset.tabletSubmitting='true';for(const button of form.querySelectorAll('button[type=submit],button:not([type])'))button.disabled=true;});window.addEventListener('pagehide',erase);window.addEventListener('pageshow',e=>{if(e.persisted)reset();});for(const name of ['pointerdown','keydown','input','scroll'])document.addEventListener(name,()=>{activity=Date.now();},{passive:true});setInterval(()=>{if(Date.now()-activity>=300000)return reset();if(csrf&&document.visibilityState==='visible')fetch(base+'/touch',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({tablet_csrf:csrf}),cache:'no-store'}).then(r=>{if(!r.ok)reset();}).catch(reset);},30000);})();`;}
module.exports={tabletBookedPage,tabletBookedResetScript,BASE};
