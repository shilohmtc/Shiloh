'use strict';
const {createClinicIpadCheckinService}=require('./clinicIpadCheckin');
const formService=require('./clientConsultationForms');
const FLAG='SHILOH_CLINIC_TABLET_BOOKED_ENABLED';
// A deployment setting to be enabled only after the separately approved
// migration/access review. Merely importing or deploying preparation does not
// activate it. App startup contains provider/schema failures to this feature.
async function prepareConfiguredClinicTablet({env={},clientRelease,createCheckin=createClinicIpadCheckinService,forms=formService}={}){
  if(env[FLAG]!=='true')return null;
  if(String(env.SHILOH_CLINIC_IPAD_CHECKIN_ENABLED).toLowerCase()!=='true'||!formService.isClientConsultationFormsEnabled(env)||!clientRelease?.status().enabled)
    throw new Error('Tablet prerequisites are not ready');
  const component=await clientRelease.prepareTabletJourney({approved:true,checkin:createCheckin(),formService:forms});
  const started=await component.start();if(!started?.ok){await component.stop();throw new Error('Tablet worker unavailable');}
  return component;
}
module.exports={prepareConfiguredClinicTablet,FLAG};
