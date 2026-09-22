const { PostgresCrmV2ClientRepository } = require('../repositories/crmV2ClientRepository');

const PROFILE_STATUS = Object.freeze({ MINIMAL: 'minimal', REGISTERED: 'registered' });
const CLIENT_STATUS = Object.freeze({ ACTIVE: 'active', ARCHIVED: 'archived' });
const GENDERS = new Set(['female', 'male', 'non_binary', 'prefer_not_to_say', 'other']);

class CrmV2Error extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'CrmV2Error';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function normalizeMobile(value = '') {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (/^0[678][0-9]{8}$/.test(digits)) return `27${digits.slice(1)}`;
  if (/^27[678][0-9]{8}$/.test(digits)) return digits;
  if (/^0027[678][0-9]{8}$/.test(digits)) return digits.slice(2);
  return null;
}

function normalizeMobileSearch(value = '') {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (/^0[678]/.test(digits)) return `27${digits.slice(1)}`;
  if (/^0027/.test(digits)) return digits.slice(2);
  return digits;
}

function localMobile(value = '') {
  const normalized = normalizeMobile(value);
  return normalized ? `0${normalized.slice(2)}` : null;
}

function normalizeName(value = '') {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}.' -]*$/u.test(name)) return null;
  return name;
}

function normalizeDateOfBirth(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new CrmV2Error('CRM_V2_DATE_OF_BIRTH_REQUIRED', 'Date of birth is required for registration.', 422);
    return null;
  }
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new CrmV2Error('CRM_V2_INVALID_DATE_OF_BIRTH', 'Date of birth must use YYYY-MM-DD.');
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text || text < '1900-01-01' || date > new Date()) {
    throw new CrmV2Error('CRM_V2_INVALID_DATE_OF_BIRTH', 'Date of birth is not valid.');
  }
  return text;
}

function normalizeGender(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new CrmV2Error('CRM_V2_GENDER_REQUIRED', 'Gender is required for registration.', 422);
    return null;
  }
  const gender = String(value).trim().toLowerCase().replace(/[ -]+/g, '_');
  if (!GENDERS.has(gender)) {
    throw new CrmV2Error('CRM_V2_INVALID_GENDER', 'Gender is not one of the supported CRM values.');
  }
  return gender;
}

function normalizeTimestamp(value, fallback) {
  const date = value === undefined || value === null ? fallback() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new CrmV2Error('CRM_V2_INVALID_INTERACTION_TIME', 'Interaction time is not valid.');
  }
  return date.toISOString();
}

function safeActorReference(value, fallback) {
  const reference = String(value || fallback || '').trim().replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 100);
  return reference || fallback;
}

function publicClient(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    normalizedMobile: row.normalized_mobile,
    dateOfBirth: row.date_of_birth ? String(row.date_of_birth).slice(0, 10) : null,
    gender: row.gender || null,
    profileStatus: row.profile_status,
    mobileVerifiedAt: row.mobile_verified_at ? new Date(row.mobile_verified_at).toISOString() : null,
    source: row.source,
    status: row.status,
    provenance: row.provenance || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function resultForOwners(rows, normalizedMobile) {
  if (rows.length === 0) return { status: 'not_found', normalizedMobile };
  if (rows.length === 1) return { status: 'found', client: publicClient(rows[0]) };
  return { status: 'conflict', normalizedMobile, clientIds: rows.map((row) => String(row.id)) };
}

function createCrmV2ClientService({ repository = new PostgresCrmV2ClientRepository(), clock = () => new Date() } = {}) {
  async function resolveExactMobile(mobile, repo = repository, options = {}) {
    const normalizedMobile = normalizeMobile(mobile);
    if (!normalizedMobile) throw new CrmV2Error('CRM_V2_INVALID_MOBILE', 'Enter a valid South African mobile number.');
    const rows = await repo.findActiveByNormalizedMobile(normalizedMobile, options);
    return resultForOwners(rows, normalizedMobile);
  }

  async function createClient({ name, mobile, actorReference = null } = {}) {
    const cleanName = normalizeName(name);
    const normalizedMobile = normalizeMobile(mobile);
    if (!cleanName) throw new CrmV2Error('CRM_V2_INVALID_NAME', 'Enter a valid client name.');
    if (!normalizedMobile) throw new CrmV2Error('CRM_V2_INVALID_MOBILE', 'Enter a valid South African mobile number.');

    try {
      return await repository.withTransaction(async (repo) => {
        await repo.lockNormalizedMobile(normalizedMobile);
        const ownership = resultForOwners(await repo.findActiveByNormalizedMobile(normalizedMobile, { forUpdate: true }), normalizedMobile);
        if (ownership.status === 'found') return { status: 'existing', client: ownership.client };
        if (ownership.status === 'conflict') return ownership;
        const created = await repo.insertClient({
          name: cleanName,
          normalizedMobile,
          dateOfBirth: null,
          gender: null,
          profileStatus: PROFILE_STATUS.MINIMAL,
          mobileVerifiedAt: null,
          source: 'staff',
          status: CLIENT_STATUS.ACTIVE,
          provenance: {
            createdVia: 'staff',
            actorReference: safeActorReference(actorReference, 'staff_service'),
          },
        });
        return { status: 'created', client: publicClient(created) };
      });
    } catch (error) {
      if (error?.code === '23505') return { status: 'conflict', normalizedMobile, clientIds: [] };
      throw error;
    }
  }

  async function getClientById(clientId) {
    if (!/^\d+$/.test(String(clientId || ''))) throw new CrmV2Error('CRM_V2_INVALID_CLIENT_ID', 'Client id must be a positive integer.');
    const row = await repository.getClientById(clientId);
    if (!row) throw new CrmV2Error('CRM_V2_CLIENT_NOT_FOUND', 'CRM V2 client not found.', 404);
    return publicClient(row);
  }

  async function searchClients({ query = '', status = CLIENT_STATUS.ACTIVE, limit = 20 } = {}) {
    const cleanQuery = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (cleanQuery.length < 2) throw new CrmV2Error('CRM_V2_SEARCH_TOO_SHORT', 'Search requires at least two characters.');
    if (status !== null && !Object.values(CLIENT_STATUS).includes(status)) throw new CrmV2Error('CRM_V2_INVALID_STATUS', 'Client status is not valid.');
    const safeLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
    const exactMobile = normalizeMobile(cleanQuery);
    const mobileSearch = normalizeMobileSearch(cleanQuery);
    const rows = await repository.searchClients({ query: cleanQuery, mobileSearch, exactMobile, status, limit: safeLimit });
    return rows.map(publicClient);
  }

  async function updateClient({ clientId, name, mobile, dateOfBirth, gender, status, actorReference = null } = {}) {
    if (!/^\d+$/.test(String(clientId || ''))) throw new CrmV2Error('CRM_V2_INVALID_CLIENT_ID', 'Client id must be a positive integer.');
    return repository.withTransaction(async (repo) => {
      const current = await repo.getClientById(clientId, { forUpdate: true });
      if (!current) throw new CrmV2Error('CRM_V2_CLIENT_NOT_FOUND', 'CRM V2 client not found.', 404);
      const patch = {};
      if (name !== undefined) {
        patch.name = normalizeName(name);
        if (!patch.name) throw new CrmV2Error('CRM_V2_INVALID_NAME', 'Enter a valid client name.');
      }
      if (dateOfBirth !== undefined) patch.dateOfBirth = normalizeDateOfBirth(dateOfBirth);
      if (gender !== undefined) patch.gender = normalizeGender(gender);
      if (status !== undefined) {
        if (!Object.values(CLIENT_STATUS).includes(status)) throw new CrmV2Error('CRM_V2_INVALID_STATUS', 'Client status is not valid.');
        patch.status = status;
      }
      if (mobile !== undefined) {
        const nextMobile = normalizeMobile(mobile);
        if (!nextMobile) throw new CrmV2Error('CRM_V2_INVALID_MOBILE', 'Enter a valid South African mobile number.');
        if (nextMobile !== current.normalized_mobile) {
          await repo.lockNormalizedMobile(nextMobile);
          const owners = await repo.findActiveByNormalizedMobile(nextMobile, { forUpdate: true });
          if (owners.some((owner) => String(owner.id) !== String(clientId))) {
            return { status: 'conflict', normalizedMobile: nextMobile, clientIds: owners.map((owner) => String(owner.id)) };
          }
          patch.normalizedMobile = nextMobile;
          patch.mobileVerifiedAt = null;
        }
      }
      const resultingStatus = patch.status ?? current.status;
      if (resultingStatus === CLIENT_STATUS.ACTIVE && current.status !== CLIENT_STATUS.ACTIVE) {
        const mobileToClaim = patch.normalizedMobile || current.normalized_mobile;
        await repo.lockNormalizedMobile(mobileToClaim);
        const owners = await repo.findActiveByNormalizedMobile(mobileToClaim, { forUpdate: true });
        if (owners.some((owner) => String(owner.id) !== String(clientId))) {
          return { status: 'conflict', normalizedMobile: mobileToClaim, clientIds: owners.map((owner) => String(owner.id)) };
        }
      }
      const resultingDob = patch.dateOfBirth !== undefined ? patch.dateOfBirth : current.date_of_birth;
      const resultingGender = patch.gender !== undefined ? patch.gender : current.gender;
      if (current.profile_status === PROFILE_STATUS.REGISTERED && (!resultingDob || !resultingGender)) {
        throw new CrmV2Error('CRM_V2_REGISTERED_PROFILE_INCOMPLETE', 'A registered client must retain date of birth and gender.', 422);
      }
      patch.provenance = {
        ...(current.provenance || {}),
        lastProfileUpdate: {
          via: 'staff',
          actorReference: safeActorReference(actorReference, 'staff_service'),
          at: clock().toISOString(),
        },
      };
      const updated = await repo.updateClient(clientId, patch);
      return { status: 'updated', client: publicClient(updated) };
    });
  }

  async function archiveClient({ clientId, actorReference = null } = {}) {
    return updateClient({ clientId, status: CLIENT_STATUS.ARCHIVED, actorReference });
  }

  async function completeRegistration({ clientId, name, dateOfBirth, gender, actorReference = null } = {}) {
    if (!/^\d+$/.test(String(clientId || ''))) throw new CrmV2Error('CRM_V2_INVALID_CLIENT_ID', 'Client id must be a positive integer.');
    const cleanName = normalizeName(name);
    if (!cleanName) throw new CrmV2Error('CRM_V2_INVALID_NAME', 'Enter a valid client name.');
    const dob = normalizeDateOfBirth(dateOfBirth, { required: true });
    const normalizedGender = normalizeGender(gender, { required: true });
    return repository.withTransaction(async (repo) => {
      const current = await repo.getClientById(clientId, { forUpdate: true });
      if (!current || current.status !== CLIENT_STATUS.ACTIVE) throw new CrmV2Error('CRM_V2_CLIENT_NOT_FOUND', 'Active CRM V2 client not found.', 404);
      const updated = await repo.updateClient(clientId, {
        name: cleanName,
        dateOfBirth: dob,
        gender: normalizedGender,
        profileStatus: PROFILE_STATUS.REGISTERED,
        provenance: {
          ...(current.provenance || {}),
          registrationCompleted: {
            via: 'whatsapp',
            actorReference: safeActorReference(actorReference, 'whatsapp_registration'),
            at: clock().toISOString(),
          },
        },
      });
      return { status: 'registered', client: publicClient(updated) };
    });
  }

  async function recordVerifiedWhatsAppInteraction({ mobile, occurredAt } = {}) {
    const normalizedMobile = normalizeMobile(mobile);
    if (!normalizedMobile) throw new CrmV2Error('CRM_V2_INVALID_MOBILE', 'Inbound sender mobile is not valid.');
    const verifiedAt = normalizeTimestamp(occurredAt, clock);
    return repository.withTransaction(async (repo) => {
      await repo.lockNormalizedMobile(normalizedMobile);
      const rows = await repo.findActiveByNormalizedMobile(normalizedMobile, { forUpdate: true });
      const ownership = resultForOwners(rows, normalizedMobile);
      if (ownership.status !== 'found') return ownership;
      const current = rows[0];
      const currentVerifiedAt = current.mobile_verified_at ? new Date(current.mobile_verified_at).toISOString() : null;
      const nextVerifiedAt = !currentVerifiedAt || verifiedAt > currentVerifiedAt ? verifiedAt : currentVerifiedAt;
      const updated = await repo.updateClient(current.id, {
        mobileVerifiedAt: nextVerifiedAt,
        provenance: {
          ...(current.provenance || {}),
          lastVerifiedWhatsAppInteraction: { at: nextVerifiedAt },
        },
      });
      return { status: 'verified', client: publicClient(updated) };
    });
  }

  async function registerWhatsAppClient({ senderMobile, name, dateOfBirth, gender, occurredAt } = {}) {
    const normalizedMobile = normalizeMobile(senderMobile);
    const cleanName = normalizeName(name);
    if (!normalizedMobile) throw new CrmV2Error('CRM_V2_INVALID_MOBILE', 'Inbound sender mobile is not valid.');
    if (!cleanName) throw new CrmV2Error('CRM_V2_INVALID_NAME', 'Enter a valid client name.');
    const dob = normalizeDateOfBirth(dateOfBirth, { required: true });
    const normalizedGender = normalizeGender(gender, { required: true });
    const verifiedAt = normalizeTimestamp(occurredAt, clock);

    try {
      return await repository.withTransaction(async (repo) => {
        await repo.lockNormalizedMobile(normalizedMobile);
        const rows = await repo.findActiveByNormalizedMobile(normalizedMobile, { forUpdate: true });
        if (rows.length > 1) return resultForOwners(rows, normalizedMobile);
        if (rows.length === 1) {
          const current = rows[0];
          const priorVerifiedAt = current.mobile_verified_at ? new Date(current.mobile_verified_at).toISOString() : null;
          const nextVerifiedAt = !priorVerifiedAt || verifiedAt > priorVerifiedAt ? verifiedAt : priorVerifiedAt;
          const updated = await repo.updateClient(current.id, {
            name: cleanName,
            dateOfBirth: dob,
            gender: normalizedGender,
            profileStatus: PROFILE_STATUS.REGISTERED,
            mobileVerifiedAt: nextVerifiedAt,
            provenance: {
              ...(current.provenance || {}),
              registrationCompleted: { via: 'whatsapp', at: verifiedAt },
              lastVerifiedWhatsAppInteraction: { at: nextVerifiedAt },
            },
          });
          return { status: current.profile_status === PROFILE_STATUS.MINIMAL ? 'registered' : 'updated', client: publicClient(updated) };
        }
        const created = await repo.insertClient({
          name: cleanName,
          normalizedMobile,
          dateOfBirth: dob,
          gender: normalizedGender,
          profileStatus: PROFILE_STATUS.REGISTERED,
          mobileVerifiedAt: verifiedAt,
          source: 'whatsapp',
          status: CLIENT_STATUS.ACTIVE,
          provenance: {
            createdVia: 'whatsapp',
            registrationCompleted: { via: 'whatsapp', at: verifiedAt },
            lastVerifiedWhatsAppInteraction: { at: verifiedAt },
          },
        });
        return { status: 'created', client: publicClient(created) };
      });
    } catch (error) {
      if (error?.code === '23505') return { status: 'conflict', normalizedMobile, clientIds: [] };
      throw error;
    }
  }

  return {
    createClient,
    resolveExactMobile,
    searchClients,
    getClientById,
    updateClient,
    archiveClient,
    completeRegistration,
    recordVerifiedWhatsAppInteraction,
    registerWhatsAppClient,
  };
}

const service = createCrmV2ClientService();

module.exports = {
  PROFILE_STATUS,
  CLIENT_STATUS,
  GENDERS,
  CrmV2Error,
  normalizeMobile,
  normalizeMobileSearch,
  localMobile,
  normalizeName,
  normalizeDateOfBirth,
  normalizeGender,
  publicClient,
  createCrmV2ClientService,
  ...service,
};
