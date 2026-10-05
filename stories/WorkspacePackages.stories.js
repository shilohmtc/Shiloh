import presentation from '../src/presentation/workspacePackagesUx.js';
const pkg = {
  id: 1,
  session_service_id: 3,
  name: 'Sports Massage — Monthly Package',
  package_price: '1400.00',
  sessions_included: 4,
  validity_months: 1,
  validity_days: 30,
  duration_minutes: 50,
  customer_description:
    'Four Sports Massage treatments of 45–50 minutes each. R1,400 paid in full upfront. Enjoy any four sessions within one month of your first treatment.',
  status: 'active',
  revision: 'a'.repeat(64),
};
const model = {
  packages: [pkg],
  purchases: [
    { client_name: 'Example client', name: pkg.name, sessions_total: 4, booked: 1, used: 1 },
  ],
  authority: {
    displayName: 'Jean-Pierre',
    permissions: { 'payment:collect': true, 'client:lookup': true },
  },
  options: {
    calendarNavigationAllowed: true,
    clientsNavigationAllowed: true,
    staffAccessScriptPath: '/calendar/staff/client.js',
  },
  createOptions: {
    categories: [{ id: 1, name: 'Massage' }],
    practitioners: [{ id: 1, displayName: 'Clinic practitioner' }],
  },
};
function surface(html) {
  return `<style>${Array.from(html.matchAll(/<style>([\s\S]*?)<\/style>/g))
    .map((m) => m[1])
    .join(
      '\n',
    )}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '')}`;
}
export default { title: 'Workspace/Packages', parameters: { layout: 'fullscreen' } };
export const Management = { render: () => surface(presentation.renderWorkspacePackages(model)) };
export const ClientBalance = {
  render: () =>
    surface(
      presentation.renderClientPackages([
        {
          ...pkg,
          entitlement_id: 1,
          entitlement_status: 'active',
          sessions_total: 4,
          booked: 1,
          used: 1,
          purchased_validity_months: 1,
        },
      ]),
    ),
};
