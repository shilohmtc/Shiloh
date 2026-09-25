import clientPresentation from '../src/presentation/workspaceCommunicationEvidenceUx.js';
import clientManagement from '../src/presentation/workspaceClientsManageUx.js';
import clientListPresentation from '../src/presentation/workspaceClientsUx.js';

const { renderClientDetailPageWithCommunications } = clientPresentation;
const { injectClientListManagement, injectClientDetailManagement } = clientManagement;
const { renderClientListPage } = clientListPresentation;

function productionSurface(pageHtml) {
  const styles = [...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n');
  const body = String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}.workspace-clients-story{min-height:100vh}.workspace-clients-story script{display:none}</style><div class="workspace-clients-story" data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
}

const authority = {
  displayName: 'Marietjie',
  businessRole: 'tenant_practitioner',
  linkedStaffId: 55,
  clientScope: { kind: 'tenant_staff', ownerStaffId: 55 },
};

const clients = [
  {
    id: 801,
    name: 'Marietjie Client One',
    normalized_mobile: '27821234001',
    date_of_birth: '1988-05-14',
    gender: 'female',
    profile_status: 'registered',
    mobile_verified_at: '2026-09-10T08:00:00.000Z',
    status: 'active',
    last_appointment_at: '2026-09-14T08:00:00.000Z',
  },
  {
    id: 802,
    name: 'Shared Shiloh Client',
    normalized_mobile: '27821234002',
    date_of_birth: '1992-03-09',
    gender: 'female',
    profile_status: 'registered',
    mobile_verified_at: '2026-09-12T09:00:00.000Z',
    status: 'active',
    last_appointment_at: '2026-09-13T10:00:00.000Z',
  },
];

const options = {
  calendarNavigationAllowed: true,
  staffAccessScriptPath: '/calendar/staff/client.js',
  notificationActionAllowed: false,
};

function listModel() {
  return {
    authority,
    manageAllowed: true,
    clients,
    hasMore: false,
    offset: 0,
    pageSize: 24,
    query: '',
    status: 'active',
  };
}

function detailModel() {
  return {
    authority,
    manageAllowed: true,
    client: {
      ...clients[0],
      revision: 'a'.repeat(64),
    },
    appointments: [
      {
        id: 9101,
        starts_at: '2026-09-30T08:00:00.000Z',
        ends_at: '2026-09-30T09:00:00.000Z',
        status: 'scheduled',
        title: 'Marietjie appointment',
        services: [{ name: 'Marietjie Signature Massage' }],
        staff: [{ name: 'Marietjie' }],
        bookingReadiness: { termsAccepted: true, depositState: 'satisfied', confirmed: true },
      },
    ],
    policyAcceptances: [
      {
        id: 501,
        policy_version: '2026-09-25-v3',
        accepted_at: '2026-09-25T08:32:00.000Z',
        channel: 'clinic_device',
        service_text: 'Marietjie Signature Massage',
        appointment_id: 9101,
      },
    ],
    policyAcceptanceUnavailable: false,
    communications: [
      {
        intent: 'booking_confirmation',
        label: 'Booking confirmation',
        statusLabel: 'Read on WhatsApp',
        occurredAt: '2026-09-13T10:00:00.000Z',
        appointmentId: 9101,
        templateName: 'shiloh_booking_confirmation_v2',
      },
    ],
    communicationsUnavailable: false,
    hasMore: false,
    historyOffset: 0,
    pageSize: 20,
  };
}

function listHtml() {
  const model = listModel();
  return injectClientListManagement(renderClientListPage(model, options), model);
}

function detailHtml() {
  const model = detailModel();
  return injectClientDetailManagement(renderClientDetailPageWithCommunications(model, options), model);
}

export default {
  title: 'Workspace/Clients',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
};

export const MarietjieClientBase = {
  render: () => productionSurface(listHtml()),
};

export const MarietjieClientManagement = {
  render: () => productionSurface(detailHtml()),
};
