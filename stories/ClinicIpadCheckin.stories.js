const { welcome, details, verify, done, setup, devices } = require('../src/presentation/clinicIpadCheckinUx');

function frame(markup) {
  const body = markup.match(/<body>([\s\S]*)<\/body>/)?.[1] || '';
  const css = markup.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
  return `<style>${css}</style><div data-checkin-story>${body.replace(/<script[\s\S]*?<\/script>/g,'')}</div>`;
}
export default { title:'Client/Clinic iPad check-in' };
export const Welcome = { render:() => frame(welcome()) };
export const SetupNeeded = { render:() => frame(welcome({setup:true})) };
export const NewClient = { render:() => frame(details()) };
export const FormReady = { render:() => frame(welcome({formReady:true})) };
export const VerifyForForm = { render:() => frame(verify({mobile:'+27820000010',dateOfBirth:'2000-01-01'})) };
export const ValidationError = { render:() => frame(details({ error:'Please check your name and mobile number.', values:{ name:'Synthetic Client AK',mobile:'082 000 0010' } })) };
export const Saved = { render:() => frame(done()) };
export const ExistingClient = { render:() => frame(done({ needsStaff:true })) };
export const StaffSetup = { render:() => frame(setup()) };
export const StaffDevices = { render:() => frame(devices([{ id:1,created_at:'2026-09-27T08:00:00Z',revoked_at:null }])) };
export const StaffPreparationStart = { render:() => frame(devices([{ id:1,created_at:'2026-09-27T08:00:00Z',revoked_at:null }],42)) };
export const StaffFormPreparation = { render:() => frame(devices([{ id:1,created_at:'2026-09-27T08:00:00Z',revoked_at:null }],42)
  .replace('<div data-form-options></div>',
    '<div data-form-options><div><label>Sarah Jacobs · mobile ending 4567 · 27/09/2026 · Consultation form · iPad <select><option>iPad 1</option></select></label><button class="button secondary" type="button">Prepare on iPad</button></div></div>')) };

export const MissingDob = {render:()=>frame(verify({mobile:'082 000 0010'}))};
export const IncorrectDetails = {render:()=>frame(verify({mobile:'082 000 0010',dateOfBirth:'2000-01-01',error:'Reception must correct your details before continuing.'}))};
