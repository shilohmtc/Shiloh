'use strict';

// Shared Workspace confirmation surface. Callers supply the action and its consequence;
// the server remains the authority for whether the action is allowed.
function confirmationStyles() {
  return `.shiloh-confirm{width:min(420px,calc(100% - 32px));max-height:calc(100dvh - 32px);border:1px solid var(--line-strong);border-radius:20px;padding:0;background:var(--panel);color:var(--ink);box-shadow:0 24px 70px rgba(20,40,30,.24)}.shiloh-confirm::backdrop{background:rgba(20,40,30,.48)}.shiloh-confirm__body{padding:24px}.shiloh-confirm h2{margin:7px 0 9px;font-size:1.3rem;line-height:1.3}.shiloh-confirm p{margin:0;color:var(--muted);line-height:1.55}.shiloh-confirm__actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:9px;margin-top:24px}.shiloh-confirm__actions .button{min-height:44px}@media(max-width:480px){.shiloh-confirm__body{padding:20px}.shiloh-confirm__actions{display:grid}.shiloh-confirm__actions .button{width:100%}}`;
}

function confirmationMarkup() {
  return `<dialog class="shiloh-confirm" data-shiloh-confirm aria-labelledby="shiloh-confirm-title" aria-describedby="shiloh-confirm-copy"><div class="shiloh-confirm__body"><span class="eyebrow">Please confirm</span><h2 id="shiloh-confirm-title" data-shiloh-confirm-title></h2><p id="shiloh-confirm-copy" data-shiloh-confirm-copy></p><div class="shiloh-confirm__actions"><button class="button" type="button" data-shiloh-confirm-cancel></button><button class="button danger" type="button" data-shiloh-confirm-action></button></div></div></dialog>`;
}

function confirmationClientScript() {
  return `(function(){'use strict';
var dialog=document.querySelector('[data-shiloh-confirm]');if(!dialog)return;
var title=dialog.querySelector('[data-shiloh-confirm-title]'),copy=dialog.querySelector('[data-shiloh-confirm-copy]'),cancel=dialog.querySelector('[data-shiloh-confirm-cancel]'),action=dialog.querySelector('[data-shiloh-confirm-action]');
window.ShilohConfirm=function(options){if(dialog.open)return Promise.resolve(false);var previous=document.activeElement;title.textContent=String(options.title||'Confirm action?');copy.textContent=String(options.copy||'');cancel.textContent=String(options.cancel||'Keep');action.textContent=String(options.action||'Confirm');action.classList.toggle('danger',options.danger!==false);action.classList.toggle('primary',options.danger===false);
return new Promise(function(resolve){var decided=false;function settle(value){if(decided)return;decided=true;dialog.close();resolve(value);}function onCancel(event){event.preventDefault();settle(false);}function onClose(){cleanup();if(!decided){decided=true;resolve(false);}if(previous&&previous.isConnected&&typeof previous.focus==='function')previous.focus({preventScroll:true});}function cleanup(){dialog.removeEventListener('cancel',onCancel);dialog.removeEventListener('close',onClose);cancel.removeEventListener('click',onKeep);action.removeEventListener('click',onAction);}function onKeep(){settle(false);}function onAction(){settle(true);}dialog.addEventListener('cancel',onCancel);dialog.addEventListener('close',onClose);cancel.addEventListener('click',onKeep);action.addEventListener('click',onAction);dialog.showModal();cancel.focus({preventScroll:true});});};
})();`;
}

module.exports = { confirmationStyles, confirmationMarkup, confirmationClientScript };
