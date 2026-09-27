'use strict';

// Shared Workspace confirmation surface. Call the client helper only for actions
// that have a material consequence; the server must revalidate the action.
function confirmationStyles() {
  return `.shiloh-confirmation{width:min(440px,calc(100% - 28px));max-height:calc(100dvh - 28px);overflow:auto;margin:auto;border:1px solid var(--line-strong,#c9d4cc);border-radius:20px;padding:0;background:var(--panel,#fffdf9);color:var(--ink,#20322b);box-shadow:0 24px 70px rgba(20,35,29,.24)}.shiloh-confirmation::backdrop{background:rgba(22,34,29,.55)}.shiloh-confirmation__body{padding:24px}.shiloh-confirmation h2{margin:6px 0 9px;font-size:1.35rem;line-height:1.25}.shiloh-confirmation p{margin:0;color:var(--muted,#56685f);font-size:.9rem;line-height:1.55}.shiloh-confirmation__actions{display:flex;justify-content:flex-end;gap:9px;margin-top:24px}.shiloh-confirmation__actions .button{min-height:46px;width:auto;padding:10px 16px;border-radius:10px}.shiloh-confirmation__actions [data-shiloh-confirm-accept]{border-color:var(--danger,#8f433d);background:var(--danger,#8f433d);color:#fff}@media(max-width:700px){.shiloh-confirmation{width:100%;max-width:none;max-height:calc(100dvh - 12px);inset:auto 0 0;margin:auto 0 0;border-width:1px 0 0;border-radius:22px 22px 0 0}.shiloh-confirmation__body{padding:22px 18px calc(22px + env(safe-area-inset-bottom))}.shiloh-confirmation__actions{display:grid;grid-template-columns:1fr 1fr}.shiloh-confirmation__actions .button{width:100%}}`;
}

function confirmationMarkup() {
  return `<dialog class="shiloh-confirmation" data-shiloh-confirmation aria-labelledby="shiloh-confirm-title" aria-describedby="shiloh-confirm-description"><div class="shiloh-confirmation__body"><span class="eyebrow">Please confirm</span><h2 id="shiloh-confirm-title" data-shiloh-confirm-title></h2><p id="shiloh-confirm-description" data-shiloh-confirm-description></p><div class="shiloh-confirmation__actions"><button class="button" type="button" data-shiloh-confirm-cancel>Keep it</button><button class="button" type="button" data-shiloh-confirm-accept></button></div></div></dialog>`;
}

function confirmationClientScript() {
  return `var shilohConfirmation=document.querySelector('[data-shiloh-confirmation]');var shilohConfirmationPending=null;
function closeShilohConfirmation(accepted){if(!shilohConfirmationPending)return;var pending=shilohConfirmationPending;shilohConfirmationPending=null;shilohConfirmation.close();pending.resolve(accepted);if(pending.trigger&&pending.trigger.isConnected)pending.trigger.focus();}
if(shilohConfirmation){shilohConfirmation.querySelector('[data-shiloh-confirm-cancel]').addEventListener('click',function(){closeShilohConfirmation(false);});shilohConfirmation.querySelector('[data-shiloh-confirm-accept]').addEventListener('click',function(){closeShilohConfirmation(true);});shilohConfirmation.addEventListener('cancel',function(event){event.preventDefault();closeShilohConfirmation(false);});}
function confirmShiloh(options){if(!shilohConfirmation||shilohConfirmationPending)return Promise.resolve(false);return new Promise(function(resolve){shilohConfirmationPending={resolve:resolve,trigger:options.trigger};shilohConfirmation.querySelector('[data-shiloh-confirm-title]').textContent=options.title;shilohConfirmation.querySelector('[data-shiloh-confirm-description]').textContent=options.description;shilohConfirmation.querySelector('[data-shiloh-confirm-cancel]').textContent=options.cancelLabel||'Keep it';var accept=shilohConfirmation.querySelector('[data-shiloh-confirm-accept]');accept.textContent=options.confirmLabel;shilohConfirmation.showModal();shilohConfirmation.querySelector('[data-shiloh-confirm-cancel]').focus();});}`;
}

module.exports = { confirmationStyles, confirmationMarkup, confirmationClientScript };
