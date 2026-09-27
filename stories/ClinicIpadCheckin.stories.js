const { welcome, details, done, setup, devices } = require('../src/presentation/clinicIpadCheckinUx');

function frame(markup) {
  const body = markup.match(/<body>([\s\S]*)<\/body>/)?.[1] || '';
  const css = markup.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
  return `<style>${css}</style><div data-checkin-story>${body.replace(/<script[\s\S]*?<\/script>/g,'')}</div>`;
}
export default { title:'Client/Clinic iPad check-in' };
export const Welcome = { render:() => frame(welcome()) };
export const NewClient = { render:() => frame(details()) };
export const ValidationError = { render:() => frame(details({ error:'Please check your name and mobile number.', values:{ name:'Sarah Jacobs',mobile:'082 123 4567' } })) };
export const Saved = { render:() => frame(done()) };
export const ExistingClient = { render:() => frame(done({ needsStaff:true })) };
export const StaffSetup = { render:() => frame(setup()) };
export const StaffDevices = { render:() => frame(devices([{ id:1,created_at:'2026-09-27T08:00:00Z',revoked_at:null }])) };
