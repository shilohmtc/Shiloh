const { sendWhatsAppMessage, sendWhatsAppReplyButtons, sendWhatsAppList, sendWhatsAppTemplate } = require("../services/whatsapp");
const { generateReply } = require("../services/ai");
const { updateProfileFromMessage } = require("../services/profileExtractor");
const { CLINIC_REDIRECT, evaluateClinicScope } = require("../services/scopeGuard");
const { processBookingMessage } = require("../services/bookingIntent");
const { processBookingPolicyMessage, sanitizeBookingReply } = require("../services/bookingPolicy");
const { processClientBookingProposalMessage } = require("../services/clientBookingApproval");
const { processRescheduleApprovalDecision } = require("../services/clientRescheduleApproval");
const { reconcileStalePendingRescheduleHolds } = require("../services/clientRescheduleHoldReconciliation");
const { commandForClientBookingButton, decorateClientBookingResult } = require("../services/clientBookingInteractive");
const { processClientAvailabilityMessage } = require("../services/clientBookingAvailability");
const { applyAvailabilityAwareDateChoices } = require("../services/clientBookingDateChoices");
const { guardBookingConfirmationIdentity, ensureBookingIdentity } = require("../services/clientBookingIdentityGate");
const { guardClientFreelancerBooking } = require("../services/clientBookingStaffGuard");
const { guardEnglishOnly } = require("../services/englishLanguageGuard");
const { processAppointmentChangeMessage } = require("../services/appointmentChange");
const { processClientRescheduleAvailabilityMessage } = require("../services/clientRescheduleAvailability");
const { processCustomerExperienceMessage } = require("../services/customerExperience");
const { processCustomerCareMessage } = require("../services/customerCare");
const { processClientIdentityMessage } = require("../services/clientIdentityOnboarding");
const { processClientTransitionWelcome } = require("../services/clientTransitionWelcome");
const { processClientServiceFamilyMessage } = require("../services/clientServiceFamilyDiscovery");
const { processClientDiscoveryMessage } = require("../services/clientDiscoveryPackages");
const { processRetiredAdminAuthorityMessage: processAdminRetiredAuthorityMessage } = require("../services/adminAuthorityRetirement");
const { hybridizeChoiceInteractive } = require("../presentation/whatsappChoicePresentation");
const { forceMatchedClientNameConfirmation } = require("../services/identityOnboardingGuard");
const { processWhatsAppMessage: processProblemReportMessage } = require("../services/problemReports");
const logger = require("../lib/logger");
function maskPhone(phone = "") { return phone.length > 4 ? `***${phone.slice(-4)}` : "***"; }
function isGreetingOnly(text = "") { return /^(hi|hello|hey|good morning|good afternoon|good evening|howzit|hiya)[!. ]*$/i.test(String(text).trim()); }
function inboundText(message){
  if(message?.type==="text") return message.text?.body?.trim()||null;
  if(message?.type==="button") {
    const id=message.button?.payload?.trim()||message.button?.text?.trim()||'';
    return commandForClientBookingButton(id)||id||null;
  }
  if(message?.type==="interactive"&&message.interactive?.type==="button_reply") {
    const id=message.interactive.button_reply?.id?.trim()||'';
    return commandForClientBookingButton(id)||id||null;
  }
  if(message?.type==="interactive"&&message.interactive?.type==="list_reply") {
    const id=message.interactive.list_reply?.id?.trim()||'';
    return id||null;
  }
  return null;
}
async function sendAdminResult(to,result){
  result = await applyAvailabilityAwareDateChoices(result);
  if (result?.interactive) {
    result = { ...result, interactive: hybridizeChoiceInteractive(result.interactive) };
  }
  let sent;
  if(result?.template?.name) sent=await sendWhatsAppTemplate(to,result.template.name,result.template.bodyParameters||[],result.template.language||process.env.WHATSAPP_TEMPLATE_LANGUAGE||'en',result.template.quickReplyPayloads||[]);
  else if(result?.interactive?.type==="list") sent=await sendWhatsAppList(to,result.interactive.body,result.interactive.buttonText||result.interactive.button,result.interactive.rows||result.interactive.sections?.[0]?.rows,result.interactive.sectionTitle||result.interactive.sections?.[0]?.title);
  else if(result?.interactive?.type==="button") sent=await sendWhatsAppReplyButtons(to,result.interactive.body,result.interactive.buttons);
  else if(result?.interactive?.buttons) sent=await sendWhatsAppReplyButtons(to,result.interactive.body,result.interactive.buttons);
  else sent=await sendWhatsAppMessage(to,result?.reply||"Sorry, Shiloh could not render that response.");
  if(typeof result?.postSend==="function"){
    try{await result.postSend();}catch(error){logger.error({err:error,to:maskPhone(to)},"Supplemental WhatsApp post-send action failed");}
  }
  return sent;
}
exports.verifyWebhook = (req,res)=>{const mode=req.query["hub.mode"],token=req.query["hub.verify_token"],challenge=req.query["hub.challenge"];if(mode==="subscribe"&&token===process.env.VERIFY_TOKEN){(req.log||logger).info("WhatsApp webhook verified");return res.status(200).send(challenge);}(req.log||logger).warn("WhatsApp webhook verification rejected");return res.sendStatus(403);};
exports.receiveWebhook=async(req,res)=>{const log=req.log||logger;try{const value=req.body.entry?.[0]?.changes?.[0]?.value;if(!value?.messages)return res.sendStatus(200);const message=value.messages[0];const from=message.from,text=inboundText(message);if(!text){log.info({messageType:message.type},"Ignoring unsupported or unknown WhatsApp message");return res.sendStatus(200);}if(!from){log.warn("Received WhatsApp message without sender");return res.sendStatus(200);}log.info({from:maskPhone(from),messageType:message.type},"Processing incoming WhatsApp message");try{
const language=await guardEnglishOnly(text);if(!language.allowed){log.info({from:maskPhone(from)},"Rejected non-English WhatsApp message");await sendWhatsAppMessage(from,language.reply);return res.sendStatus(200);}
const problemReport=await processProblemReportMessage(from,text);if(problemReport.handled){log.info({from:maskPhone(from)},"Handled WhatsApp problem report");await sendAdminResult(from,problemReport);return res.sendStatus(200);}
const bookingProposal=await processClientBookingProposalMessage(from,text);if(bookingProposal.handled){log.info({from:maskPhone(from),status:bookingProposal.status||null},"Handled client booking proposal response");await sendAdminResult(from,bookingProposal);return res.sendStatus(200);}
if(/^reschedule_approval_(?:approve|decline)_\d+$/i.test(String(text||'').trim()))await reconcileStalePendingRescheduleHolds();
const rescheduleApproval=await processRescheduleApprovalDecision(from,text);if(rescheduleApproval.handled){log.info({from:maskPhone(from),status:rescheduleApproval.status||null},"Handled retained appointment-reschedule approval decision");await sendAdminResult(from,rescheduleApproval);return res.sendStatus(200);}
const retiredAdminAuthority=await processAdminRetiredAuthorityMessage(from,text);if(retiredAdminAuthority.handled){log.info({from:maskPhone(from),disposition:retiredAdminAuthority.disposition?.kind||null},"Handled retired WhatsApp staff authority safely");await sendAdminResult(from,retiredAdminAuthority);return res.sendStatus(200);}
const customerExperience=await processCustomerExperienceMessage(from,text);if(customerExperience.handled){await sendAdminResult(from,customerExperience);return res.sendStatus(200);}
const customerCare=await processCustomerCareMessage(from,text);if(customerCare.handled){await sendAdminResult(from,customerCare);return res.sendStatus(200);}
const transitionWelcome=await processClientTransitionWelcome(from,text);if(transitionWelcome.handled){await sendAdminResult(from,transitionWelcome);return res.sendStatus(200);}
const identity=await processClientIdentityMessage(from,text);if(identity.handled){let reply=identity.reply;if(identity.identityStatus==="matched_incomplete"&&identity.client?.id){const forced=await forceMatchedClientNameConfirmation(from,identity.client.id);if(forced)reply=`Welcome back, ${identity.client.display_name}. Before I can continue with the booking, please confirm your full name.`;}if(identity.onboardingComplete&&identity.resumeBooking){const booking=decorateClientBookingResult(await processBookingMessage(from,"booking"));if(booking.handled&&booking.interactive){booking.interactive={...booking.interactive,body:`${reply}\n\n${booking.interactive.body}`};await sendAdminResult(from,booking);return res.sendStatus(200);}if(booking.handled&&booking.reply)reply=`${reply}\n\n${sanitizeBookingReply(booking.reply)}`;}await sendWhatsAppMessage(from,reply);return res.sendStatus(200);}
if(identity.identityStatus==="matched_incomplete"&&identity.client?.display_name&&isGreetingOnly(text)){await sendWhatsAppMessage(from,`Welcome back, ${identity.client.display_name} 👋 How can I help you today?`);return res.sendStatus(200);}
const familyDiscovery=await processClientServiceFamilyMessage(from,text);if(familyDiscovery.handled){await sendAdminResult(from,familyDiscovery);return res.sendStatus(200);}
const clientDiscovery=await processClientDiscoveryMessage(from,text);if(clientDiscovery.handled){await sendAdminResult(from,clientDiscovery);return res.sendStatus(200);}
const clientAvailability=await processClientAvailabilityMessage(from,text);if(clientAvailability.handled){if(clientAvailability.intent?.status==="awaiting_confirmation"){const availabilityIdentity=await ensureBookingIdentity(from);if(!availabilityIdentity.ready){await sendWhatsAppMessage(from,availabilityIdentity.reply);return res.sendStatus(200);}}await sendAdminResult(from,clientAvailability);return res.sendStatus(200);}
const scope=evaluateClinicScope(text);if(!scope.allowed){await sendWhatsAppMessage(from,CLINIC_REDIRECT);return res.sendStatus(200);}
const freelancerGuard=await guardClientFreelancerBooking(text);if(freelancerGuard.blocked){log.info({from:maskPhone(from),staff:freelancerGuard.staff?.display_name||null},"Blocked client freelancer booking request");await sendWhatsAppMessage(from,freelancerGuard.reply);return res.sendStatus(200);}
const rescheduleAvailability=await processClientRescheduleAvailabilityMessage(from,text);if(rescheduleAvailability.handled){await sendAdminResult(from,rescheduleAvailability);return res.sendStatus(200);}
const appointmentChangeText=/^(reschedule|cancel)$/i.test(String(text).trim())?`${String(text).trim()} appointment`:text;
const appointmentChange=await processAppointmentChangeMessage(from,appointmentChangeText);if(appointmentChange.handled){await sendAdminResult(from,appointmentChange);return res.sendStatus(200);}
const bookingIdentity=await guardBookingConfirmationIdentity(from,text);if(bookingIdentity.handled){await sendWhatsAppMessage(from,bookingIdentity.reply);return res.sendStatus(200);}
const bookingPolicy=await processBookingPolicyMessage(from,text);if(bookingPolicy.handled){await sendWhatsAppMessage(from,bookingPolicy.reply);return res.sendStatus(200);}
const booking=decorateClientBookingResult(await processBookingMessage(from,text));if(booking.handled){await sendAdminResult(from,booking.interactive?booking:{...booking,reply:sanitizeBookingReply(booking.reply)});return res.sendStatus(200);}
await updateProfileFromMessage(from,text);const reply=await generateReply(from,text);await sendWhatsAppMessage(from,reply);
}catch(error){log.error({err:error,from:maskPhone(from)},"Failed to process WhatsApp message");try{await sendWhatsAppMessage(from,"Sorry, I'm having trouble responding right now. Please try again in a moment.");}catch(fallbackError){log.error({err:fallbackError},"Failed to send WhatsApp fallback message");return res.sendStatus(500);}}return res.sendStatus(200);}catch(error){log.error({err:error},"Unhandled WhatsApp webhook error");return res.sendStatus(500);}};
