const { WorkspaceClientMutationError } = require('./workspaceClientMutationError');

const retainedMessage = 'This profile cannot be permanently deleted because it is linked to appointments, payments, an app account, or other clinic records. No records were deleted.';
function quoteIdentifier(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }

// Check every foreign key, including CASCADE and SET NULL, before deleting.
// New relationships cannot be attached while the canonical client is locked.
async function deleteUnlinkedClient({ client, clientId, relationshipId, mobile }) {
  const others = await client.query('SELECT id FROM crm_v2_client_relationships WHERE client_id=$1 AND id<>$2 LIMIT 1', [clientId, relationshipId]);
  if (others.rows.length) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_DELETE_SHARED', 'This profile also belongs to another client list and cannot be permanently deleted. No records were deleted.', 409);
  const references = await client.query(`
    SELECT ns.nspname AS schema_name, rel.relname AS table_name, att.attname AS column_name,
           cardinality(fk.conkey) AS column_count, target.attname AS target_column,
           fk.conrelid='crm_v2_client_relationships'::regclass AS is_relationship
      FROM pg_constraint fk
      JOIN pg_class rel ON rel.oid=fk.conrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      JOIN pg_attribute att ON att.attrelid=fk.conrelid AND att.attnum=fk.conkey[1]
      JOIN pg_attribute target ON target.attrelid=fk.confrelid AND target.attnum=fk.confkey[1]
     WHERE fk.contype='f' AND fk.confrelid='crm_v2_clients'::regclass
     ORDER BY ns.nspname,rel.relname,att.attname`);
  if (!references.rows.some(r => r.is_relationship === true)) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_DELETE_UNAVAILABLE', 'Permanent deletion is unavailable until the client relationships can be verified.', 409);
  for (const reference of references.rows) {
    if (Number(reference.column_count) !== 1 || reference.target_column !== 'id') throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_DELETE_LINKED', retainedMessage, 409);
    if (reference.is_relationship === true && reference.column_name === 'client_id') continue;
    const table = `${quoteIdentifier(reference.schema_name)}.${quoteIdentifier(reference.table_name)}`;
    const result = await client.query(`SELECT 1 FROM ${table} WHERE ${quoteIdentifier(reference.column_name)}=$1 LIMIT 1`, [clientId]);
    if (result.rows.length) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_DELETE_LINKED', retainedMessage, 409);
  }
  const draft = await client.query('SELECT phone FROM booking_intents WHERE phone=$1 LIMIT 1 FOR UPDATE', [mobile]);
  if (draft.rows.length) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_DELETE_DRAFT', 'This profile has an unfinished booking draft. Discard that draft in My Shiloh before deleting the profile. No records were deleted.', 409);
  const removed = await client.query('DELETE FROM crm_v2_clients WHERE id=$1 RETURNING id', [clientId]);
  if (removed.rows.length !== 1) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_NOT_FOUND', 'Client was not found.', 404);
}

module.exports = { deleteUnlinkedClient, retainedMessage };
