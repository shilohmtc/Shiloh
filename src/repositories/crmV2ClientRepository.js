const { pool } = require('../db/pool');

const CLIENT_COLUMNS = `
  id,name,normalized_mobile,date_of_birth,gender,profile_status,
  mobile_verified_at,source,status,provenance,created_at,updated_at
`;

class PostgresCrmV2ClientRepository {
  constructor(queryable = pool) {
    this.queryable = queryable;
  }

  async withTransaction(work) {
    if (typeof this.queryable?.release === 'function') return work(this);
    if (typeof this.queryable?.connect !== 'function') return work(this);
    const client = await this.queryable.connect();
    const transaction = new PostgresCrmV2ClientRepository(client);
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await work(transaction);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async lockNormalizedMobile(normalizedMobile) {
    await this.queryable.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`crm-v2-mobile:${normalizedMobile}`]
    );
  }

  async findActiveByNormalizedMobile(normalizedMobile, { forUpdate = false } = {}) {
    const result = await this.queryable.query(
      `SELECT ${CLIENT_COLUMNS}
         FROM crm_v2_clients
        WHERE normalized_mobile=$1 AND status='active'
        ORDER BY id${forUpdate ? ' FOR UPDATE' : ''}`,
      [normalizedMobile]
    );
    return result.rows;
  }

  async getClientById(clientId, { forUpdate = false } = {}) {
    const result = await this.queryable.query(
      `SELECT ${CLIENT_COLUMNS}
         FROM crm_v2_clients
        WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [clientId]
    );
    return result.rows[0] || null;
  }

  async insertClient(client) {
    const result = await this.queryable.query(
      `INSERT INTO crm_v2_clients (
         name,normalized_mobile,date_of_birth,gender,profile_status,
         mobile_verified_at,source,status,provenance
       ) VALUES ($1,$2,$3::date,$4,$5,$6::timestamptz,$7,$8,$9::jsonb)
       RETURNING ${CLIENT_COLUMNS}`,
      [
        client.name,
        client.normalizedMobile,
        client.dateOfBirth,
        client.gender,
        client.profileStatus,
        client.mobileVerifiedAt,
        client.source,
        client.status,
        JSON.stringify(client.provenance),
      ]
    );
    return result.rows[0];
  }

  async updateClient(clientId, patch) {
    const columnByField = {
      name: 'name',
      normalizedMobile: 'normalized_mobile',
      dateOfBirth: 'date_of_birth',
      gender: 'gender',
      profileStatus: 'profile_status',
      mobileVerifiedAt: 'mobile_verified_at',
      status: 'status',
      provenance: 'provenance',
    };
    const entries = Object.entries(patch).filter(([field]) => columnByField[field]);
    if (!entries.length) return this.getClientById(clientId);
    const assignments = entries.map(([field], index) => {
      const column = columnByField[field];
      const cast = field === 'dateOfBirth' ? '::date' : field === 'mobileVerifiedAt' ? '::timestamptz' : field === 'provenance' ? '::jsonb' : '';
      return `${column}=$${index + 2}${cast}`;
    });
    if (entries.some(([field]) => field === 'name')) assignments.push('first_name=NULL', 'surname=NULL');
    const values = entries.map(([field, value]) => field === 'provenance' ? JSON.stringify(value) : value);
    const result = await this.queryable.query(
      `UPDATE crm_v2_clients
          SET ${assignments.join(',')},updated_at=NOW()
        WHERE id=$1
        RETURNING ${CLIENT_COLUMNS}`,
      [clientId, ...values]
    );
    return result.rows[0] || null;
  }

  async searchClients({ query, mobileSearch, exactMobile, status, limit }) {
    const namePattern = `%${query}%`;
    const mobileDigits = mobileSearch || query.replace(/[^0-9]/g, '');
    const mobilePattern = mobileDigits ? `%${mobileDigits}%` : null;
    const result = await this.queryable.query(
      `SELECT ${CLIENT_COLUMNS}
         FROM crm_v2_clients
        WHERE ($1::text IS NULL OR status=$1)
          AND (LOWER(name) LIKE LOWER($2) OR ($3::text IS NOT NULL AND normalized_mobile LIKE $3))
        ORDER BY
          CASE WHEN normalized_mobile=$4 THEN 0 ELSE 1 END,
          LOWER(name),id
        LIMIT $5`,
      [status, namePattern, mobilePattern, exactMobile, limit]
    );
    return result.rows;
  }
}

module.exports = { CLIENT_COLUMNS, PostgresCrmV2ClientRepository };
