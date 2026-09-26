import servicePresentation from '../src/presentation/workspaceServicesUx.js';

const { renderServicesListPage, renderServiceDetailPage } = servicePresentation;

function productionSurface(pageHtml) {
  const styles = [...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n');
  const body = String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}.workspace-services-story{min-height:100vh}.workspace-services-story script{display:none}</style><div class="workspace-services-story" data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
}

const services = [
  {
    id: 701,
    name: 'Marietjie Signature Massage',
    category_name: 'Massage',
    duration_minutes: 60,
    processing_time_minutes: 0,
    extra_time_minutes: 0,
    total_minutes: 60,
    variable_price: false,
    price: '650.00',
    display_price: null,
    status: 'active',
    assigned_staff_count: 1,
    client_bookable_staff_count: 1,
    booking_eligibility: { eligible: true, clientBookableStaffCount: 1 },
  },
  {
    id: 702,
    name: 'Marietjie Deep Tissue',
    category_name: 'Massage',
    duration_minutes: 75,
    processing_time_minutes: 0,
    extra_time_minutes: 0,
    total_minutes: 75,
    variable_price: false,
    price: '780.00',
    display_price: null,
    status: 'active',
    assigned_staff_count: 1,
    client_bookable_staff_count: 1,
    booking_eligibility: { eligible: true, clientBookableStaffCount: 1 },
  },
];

const categories = [
  { id: 1, name: 'Pedicures & Foot Care', displayOrder: 1, status: 'active' },
  { id: 3, name: 'Massage', displayOrder: 3, status: 'active' },
  { id: 2, name: 'Facials', displayOrder: 2, status: 'active' },
];

const options = {
  calendarNavigationAllowed: true,
  clientsNavigationAllowed: true,
  staffNavigationAllowed: false,
  staffAccessScriptPath: '/calendar/staff/client.js',
  manageAllowed: true,
};

function listHtml() {
  return renderServicesListPage({
    authority: {
      displayName: 'Marietjie',
      businessRole: 'tenant_practitioner',
      serviceScope: 'own_services',
      linkedStaffId: 55,
    },
    services,
    hasMore: false,
    offset: 0,
    pageSize: 30,
    query: '',
    status: 'active',
  }, options);
}

function detailHtml() {
  return renderServiceDetailPage({
    authority: {
      displayName: 'Marietjie',
      businessRole: 'tenant_practitioner',
      serviceScope: 'own_services',
      linkedStaffId: 55,
    },
    service: {
      ...services[0],
      category_id: 3,
      revision: 'a'.repeat(64),
      customer_description: 'A treatment available in Marietjie’s assigned service set.',
      booking_note: 'Please arrive a few minutes before your appointment.',
    },
    categories,
    assignedStaff: [
      { id: 55, display_name: 'Marietjie', resource_type: 'practitioner', status: 'active', client_bookable: true },
    ],
    practitioners: [
      { id: 55, display_name: 'Marietjie', status: 'active', client_bookable: true, assigned: true },
      { id: 56, display_name: 'Abigail', status: 'active', client_bookable: true, assigned: false },
    ],
    bookingEligibility: { eligible: true, clientBookableStaffCount: 1, authority: 'read_projection_only' },
  }, options);
}


function uncategorisedDetailHtml() {
  return renderServiceDetailPage({
    authority: {
      displayName: 'Christel',
      businessRole: 'owner',
      serviceScope: 'all_services',
      linkedStaffId: 12,
    },
    service: {
      id: 703,
      name: 'Toe Gel Only',
      category_id: null,
      category_name: null,
      duration_minutes: 30,
      processing_time_minutes: 0,
      extra_time_minutes: 0,
      total_minutes: 30,
      variable_price: false,
      price: '250.00',
      display_price: null,
      status: 'active',
      revision: 'b'.repeat(64),
      customer_description: 'A focused gel application service for toes.',
      booking_note: null,
      catalogue_issues: [{ code: 'missing_category', label: 'Category required', message: 'Assign a category before this service can be offered for booking.', blocking: true }],
    },
    categories,
    assignedStaff: [
      { id: 12, display_name: 'Christel', resource_type: 'practitioner', status: 'active', client_bookable: true },
    ],
    practitioners: [
      { id: 12, display_name: 'Christel', status: 'active', client_bookable: true, assigned: true },
    ],
    bookingEligibility: { eligible: false, categoryConfigured: false, clientBookableStaffCount: 1, authority: 'read_projection_only' },
  }, { ...options, staffNavigationAllowed: true });
}

export default {
  title: 'Workspace/Services',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
};

export const MarietjieAssignedServices = {
  render: () => productionSurface(listHtml()),
};

export const MarietjieServiceManagement = {
  render: () => productionSurface(detailHtml()),
};

export const UncategorisedServiceManagement = {
  render: () => productionSurface(uncategorisedDetailHtml()),
};

export const ChristelCategoryManagement = {
  render: () => productionSurface(renderServicesListPage({
    authority: { displayName: 'Christel', businessRole: 'owner', serviceScope: 'all_services' },
    services: [], hasMore: false, offset: 0, pageSize: 30, status: 'active',
    categories: [
      { id: 3, name: 'Massage', displayOrder: 3, status: 'active', serviceCount: 14 },
      { id: 2, name: 'Facials', displayOrder: 2, status: 'active', serviceCount: 5 },
      { id: 18, name: 'New category', displayOrder: 4, status: 'active', serviceCount: 0 },
    ],
  }, { ...options, staffNavigationAllowed: true })),
};
