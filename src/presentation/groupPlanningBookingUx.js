'use strict';
const { displayPhone } = require('./southAfricanPhone');
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// The route supplies a verified request. The return is derived here as well,
// rather than treating a URL or client identity from a query as authority.
function requestReturn(context) {
  const id = String(context?.requestId || '');
  return /^[1-9][0-9]*$/.test(id) && Number.isSafeInteger(Number(id)) ? `/calendar/workspace#planning-request-${id}` : null;
}

function groupRequestPanel(context) {
  if (!requestReturn(context)) return '';
  return `<section class="panel" data-group-request><span class="eyebrow">Group enquiry #${escape(context.requestId)}</span><h2>Enquiry contact</h2><p data-organiser-selected><strong>${escape(context.organiser.name)}</strong> · ${escape(displayPhone(context.organiser.mobile))}</p><input type="hidden" data-organiser-id value="${escape(context.organiser.clientId)}"><p class="hint">The organiser is not automatically a guest. Select each person receiving treatment below, including the organiser only if they are attending.</p><p>${escape(context.serviceDetail)}</p><p class="hint">${context.preferredDate ? `Requested date: ${escape(context.preferredDate)}. ` : 'Date flexible. '}${context.preferredDaypart && context.preferredDaypart !== 'any' ? `${escape(context.preferredDaypart)} preferred. ` : ''}${context.guestCount ? `About ${escape(context.guestCount)} guests requested. ` : ''}This form books 3–10 guests. Agree the actual guests, treatments and time before reviewing.</p>${context.occasionNote ? `<p class="hint">Occasion: ${escape(context.occasionNote)}</p>` : ''}${context.clientNote ? `<p class="hint">Client note: ${escape(context.clientNote)}</p>` : ''}<p class="hint">After booking, return to this enquiry, review the linked group and confirm it arranged. Booking updates keep their existing recipients; this contact does not receive private treatment information.</p></section>`;
}

function groupRequestClientSupport() {
  return `var requestContext=OPTIONS.requestContext||null,requestHasDraft=false,requestDraftKey=null,requestReviewBusy=false,requestReviewVersion=0,requestReturning=false;
function groupRequestPayload(){return requestContext?{planningRequestId:requestContext.requestId,planningRequestRevision:requestContext.revision,organiserClientId:requestContext.organiser.clientId}:{}}
function groupRequestDiscardPayload(){return requestContext?{planningRequestId:requestContext.requestId,requestDraftKey:requestDraftKey}: {}}
function groupRequestReturn(value){var id=String(value||requestContext&&requestContext.requestId||'');return /^[1-9][0-9]*$/.test(id)&&Number.isSafeInteger(Number(id))?'/calendar/workspace#planning-request-'+id:null}
function showGroupRequestReview(review,host){if(!requestContext)return;if(!review.requestContext||String(review.requestContext.requestId)!==String(requestContext.requestId)||review.requestContext.revision!==requestContext.revision||String(review.requestContext.organiser&&review.requestContext.organiser.clientId)!==String(requestContext.organiser.clientId)||!/^[A-Za-z0-9_-]{32}$/.test(review.requestReviewKey||''))throw new Error('The enquiry review changed. Reload the request.');host.prepend(row('Enquiry contact',review.requestContext.organiser.name+' · '+displayPhone(review.requestContext.organiser.mobile)),row('Group enquiry','#'+review.requestContext.requestId+' · '+review.requestContext.serviceDetail));if(review.requestReviewKey){guestReviewKey=review.requestReviewKey;requestDraftKey=review.requestReviewKey}}
async function backToGroupRequest(event){if(!event.target.closest('[data-group-request-return]'))return;event.preventDefault();if(requestReturning)return;if(requestReviewBusy||guestCommitInFlight||uncertainGuestCommit){status('Finish checking this booking before returning to the enquiry.','error');return}var destination=groupRequestReturn();if(!destination)return;requestReturning=true;try{if(requestHasDraft||prepared){var response=await post('/discard',groupRequestDiscardPayload(),true),body=await json(response);if(!response.ok)throw new Error(body.error||'The review could not be discarded. Try again.');requestHasDraft=false;requestDraftKey=null;clearReview()}window.location.assign(destination)}catch(error){status(error.message||'The review could not be discarded. Try again.','error');requestReturning=false}}
document.addEventListener('click',backToGroupRequest);
document.addEventListener('input',function(){requestReviewVersion++});
document.addEventListener('change',function(){requestReviewVersion++});
window.addEventListener('pageshow',function(event){if(event.persisted&&requestContext){requestReturning=false;clearReview();status('Review the current group details before creating a booking.')}});
`;
}

module.exports = { requestReturn, groupRequestPanel, groupRequestClientSupport };
