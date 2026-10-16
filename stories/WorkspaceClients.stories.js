import clientPresentation from '../src/presentation/workspaceCommunicationEvidenceUx.js';
import clientManagement from '../src/presentation/workspaceClientsManageUx.js';
import clientListPresentation from '../src/presentation/workspaceClientsUx.js';
import clientDocuments from '../src/presentation/workspaceClientDocumentsUx.js';
import formsPresentation from '../src/presentation/workspaceFormsUx.js';

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
    name: 'Synthetic Client AR',
    normalized_mobile: '27820000011',
    date_of_birth: '2000-01-01',
    gender: 'female',
    profile_status: 'registered',
    mobile_verified_at: '2026-09-10T08:00:00.000Z',
    status: 'active',
    last_visit_at: '2026-09-14T08:00:00.000Z',
  },
  {
    id: 802,
    name: 'Synthetic Client AS',
    normalized_mobile: '27820000012',
    date_of_birth: '2000-01-01',
    gender: 'female',
    profile_status: 'registered',
    mobile_verified_at: '2026-09-12T09:00:00.000Z',
    status: 'active',
    last_visit_at: '2026-09-13T10:00:00.000Z',
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

function detailHtml(clinic = false) {
  const model = detailModel();
  if (clinic) model.authority = { ...model.authority, displayName: 'Synthetic clinic owner', businessRole: 'owner', deleteAllowed: true, clientScope: { kind: 'clinic', ownerStaffId: null } };
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

function documentsModel({ reception = false, empty = false, unavailable = false } = {}) {
  const model = detailModel();
  model.authority = { ...model.authority, displayName: reception ? 'Reception' : 'Christel', businessRole: reception ? 'booking_operator' : 'owner' };
  model.manageAllowed = false;
  model.policyAcceptances = empty ? [] : [{ ...model.policyAcceptances[0], crm_v2_client_id: model.client.id, has_snapshot: true }];
  model.consultationHistory = { page: 0, hasMore: false, items: empty ? [] : [{ reference: '701', formTitle: 'Massage consultation', appointmentId: 9101, signedAt: '2026-10-13T08:32:00Z', services: ['Signature Massage'], canOpen: !reception }] };
  model.policyAcceptanceUnavailable = unavailable;
  model.consultationHistoryUnavailable = unavailable;
  return model;
}

function documentsHtml(settings) {
  const model = documentsModel(settings);
  return clientDocuments.injectClientConsultationHistory(renderClientDetailPageWithCommunications(model, options), model);
}

export const ClinicClientDocuments = { render: () => productionSurface(documentsHtml({})) };
export const ReceptionClientDocuments = { render: () => productionSurface(documentsHtml({ reception: true })) };
export const ClientDocumentsEmpty = { render: () => productionSurface(documentsHtml({ empty: true })) };
export const ClientDocumentsUnavailable = { render: () => productionSurface(documentsHtml({ unavailable: true })) };

const policyModel = {
  authority: { displayName: 'Christel' }, client: clients[0],
  acceptance: { id: 501, policy_version: 'example-v1', accepted_at: '2026-10-13T08:32:00Z', channel: 'my_shiloh', appointment_id: 9101,
    policy_text_snapshot: 'Example policy wording for interface review only.\nThis demonstrates the exact text saved when the client accepted.' },
};
export const PolicyAcceptanceRecord = { render: () => productionSurface(clientDocuments.renderPolicyDocument(policyModel)) };
export const HistoricalPolicyRecord = { render: () => productionSurface(clientDocuments.renderPolicyDocument({ ...policyModel, acceptance: { ...policyModel.acceptance, policy_text_snapshot: null } })) };
export const SignedConsultationRecord = { render: () => productionSurface(formsPresentation.renderSubmissionPage({
  authority: { displayName: 'Christel' }, clientName: 'Synthetic Client', reference: '701',
  form: { title: 'Massage consultation', version: 1, consentText: 'Example signed declaration for interface review only.',
    sections: [{ title: 'Health information', definition: { groups: [{ title: 'Allergies', questions: [{ key: 'allergies', type: 'yes_no', label: 'Do you have any allergies?' }] }] } }] },
  answers: { allergies: 'no' }, signature: { name: 'Synthetic Client', method: 'typed_name' }, signedAt: '2026-10-13T08:32:00Z',
  appointment: { id: 9101, startsAt: '2026-10-14T08:00:00Z', services: ['Signature Massage'], practitioners: ['Christel'] },
}, { clientProfileId: 801 })) };

export const ClinicClientDeletion = { render: () => productionSurface(detailHtml(true)) };

// Fabricated next booking and completed visit are independent facts.
export const NextAppointmentAndLastVisit = { render: () => productionSurface(renderClientListPage({
  ...listModel(), clients: [
    {...clients[0],next_appointment_at:'2030-11-08T08:00:00Z',last_visit_at:'2026-09-14T08:00:00Z'},
    {...clients[1],next_appointment_at:'2030-11-09T09:00:00Z',last_visit_at:null},
  ],
}, options)) };
export const AwaitingConfirmationHistory = { render: () => {
  const model=detailModel();
  model.appointments=[
    {...model.appointments[0],status:'scheduled',bookingRequestState:'pending'},
    {...model.appointments[0],status:'scheduled',bookingRequestState:'awaiting_client_confirmation'},
    {...model.appointments[0],status:'completed',bookingRequestState:null},
  ];
  return productionSurface(renderClientDetailPageWithCommunications(model,options));
} };
