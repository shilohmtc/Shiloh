const workspaceClients = require('./workspaceClients');
const workspaceStaff = require('./workspaceStaff');
const workspaceServices = require('./workspaceServices');
const workspaceReports = require('./workspaceReportsProfileView');
const workspaceClinicHours = require('./workspaceClinicHoursReadView');

const DESTINATIONS = Object.freeze({
  dashboard: '/calendar/workspace',
  calendar: '/calendar/read-only?view=week&staff=all',
  clients: '/calendar/clients',
  messages: '/calendar/messages',
  staff: '/calendar/team/staff-access',
  services: '/calendar/services',
  reports: '/calendar/reports',
  clinicHours: '/calendar/clinic-hours',
});

function allowedDestination(allowed, key) {
  return allowed ? { allowed: true, href: DESTINATIONS[key] } : { allowed: false, href: null };
}

function createWorkspaceNavigationService({
  clientAccessService = workspaceClients,
  staffAccessService = workspaceStaff,
  servicesAccessService = workspaceServices,
  reportsAccessService = workspaceReports,
  clinicHoursAccessService = workspaceClinicHours,
} = {}) {
  async function resolve({ session } = {}) {
    const adminId = session?.adminId;
    const calendarAllowed = Boolean(session?.viewer);
    const [clients, staff, services, reports, clinicHours] = await Promise.allSettled([
      clientAccessService.resolveAccess(adminId),
      staffAccessService.resolveAccess(adminId),
      servicesAccessService.resolveAccess(adminId),
      reportsAccessService.resolveAccess(adminId),
      clinicHoursAccessService.resolveAccess(adminId),
    ]);
    const clientsAllowed = clients.status === 'fulfilled' && Boolean(clients.value);
    return {
      dashboard: allowedDestination(calendarAllowed, 'dashboard'),
      calendar: allowedDestination(calendarAllowed, 'calendar'),
      clients: allowedDestination(clientsAllowed, 'clients'),
      messages: allowedDestination(clientsAllowed, 'messages'),
      staff: allowedDestination(staff.status === 'fulfilled' && Boolean(staff.value), 'staff'),
      services: allowedDestination(services.status === 'fulfilled' && Boolean(services.value), 'services'),
      reports: allowedDestination(reports.status === 'fulfilled' && Boolean(reports.value), 'reports'),
      clinicHours: allowedDestination(clinicHours.status === 'fulfilled' && Boolean(clinicHours.value), 'clinicHours'),
    };
  }

  return { resolve };
}

const service = createWorkspaceNavigationService();

module.exports = {
  DESTINATIONS,
  allowedDestination,
  createWorkspaceNavigationService,
  ...service,
};
