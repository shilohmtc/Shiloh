const { pool } = require('../db/pool');
const { resolveManageAccess, WorkspaceServicesError, positiveId } = require('./workspaceServices');

function categoryName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) throw new WorkspaceServicesError('CATEGORY_INVALID_NAME', 'Category name must be 1 to 120 characters.', 400);
  return name;
}

function displayOrder(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw) || Number(raw) > 10000) throw new WorkspaceServicesError('CATEGORY_INVALID_ORDER', 'Display order must be a whole number from 0 to 10000.', 400);
  return Number(raw);
}

function allowed(authority) {
  return authority && authority.serviceScope === 'all_services' && (
    (authority.businessRole === 'owner' && authority.displayName.toLowerCase() === 'christel') ||
    (authority.businessRole === 'booking_operator' && authority.displayName.toLowerCase() === 'shiloh reception')
  );
}

function createWorkspaceServiceCategories({ db = pool, manageAccess = resolveManageAccess } = {}) {
  async function requireAccess(adminId, client = db) {
    const authority = await manageAccess(adminId, client);
    if (!allowed(authority)) throw new WorkspaceServicesError('CATEGORY_FORBIDDEN', 'Category management is available to Christel and Reception.', 403);
    return authority;
  }

  async function list(adminId) {
    await requireAccess(adminId);
    const result = await db.query(`/* workspaceCategories:list */
      SELECT c.id, c.name, c.display_order, c.status, COUNT(s.id)::int AS service_count
      FROM service_categories c LEFT JOIN services s ON s.category_id=c.id
      GROUP BY c.id ORDER BY c.display_order, LOWER(c.name), c.id`);
    return result.rows.map(row => ({ id: Number(row.id), name: row.name, displayOrder: Number(row.display_order), status: row.status, serviceCount: Number(row.service_count) }));
  }

  async function mutate({ adminId, id, name, order, action }) {
    if (typeof db.connect !== 'function') throw new Error('Category mutations require a transactional database');
    const categoryId = action === 'create' ? null : positiveId(id);
    if (action !== 'create' && !categoryId) throw new WorkspaceServicesError('CATEGORY_INVALID_ID', 'Category reference is invalid.', 400);
    const nextName = action === 'delete' ? null : categoryName(name);
    const nextOrder = action === 'delete' ? null : displayOrder(order);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const operator = await requireAccess(adminId, client);
      // Serialize catalogue name changes so capitalization variants cannot race.
      await client.query('SELECT pg_advisory_xact_lock(918404)');
      let before = null;
      if (categoryId) {
        const current = await client.query('SELECT id, name, display_order, status FROM service_categories WHERE id=$1 FOR UPDATE', [categoryId]);
        if (current.rows.length !== 1) throw new WorkspaceServicesError('CATEGORY_NOT_FOUND', 'Category was not found.', 404);
        before = current.rows[0];
      }
      let changed;
      if (nextName) {
        const duplicate = await client.query('SELECT id FROM service_categories WHERE LOWER(name)=LOWER($1) AND id IS DISTINCT FROM $2 LIMIT 1', [nextName, categoryId]);
        if (duplicate.rows.length) throw new WorkspaceServicesError('CATEGORY_DUPLICATE', 'A category with this name already exists.', 409);
      }
      if (action === 'create') {
        changed = await client.query('INSERT INTO service_categories(name,display_order) VALUES($1,$2) RETURNING id,name,display_order,status', [nextName, nextOrder]);
      } else if (action === 'edit') {
        changed = await client.query('UPDATE service_categories SET name=$2,display_order=$3,updated_at=NOW() WHERE id=$1 RETURNING id,name,display_order,status', [categoryId, nextName, nextOrder]);
      } else if (action === 'delete') {
        const usages = await client.query('SELECT COUNT(*)::int AS count FROM services WHERE category_id=$1', [categoryId]);
        if (Number(usages.rows[0]?.count) > 0) throw new WorkspaceServicesError('CATEGORY_IN_USE', 'Move all services to another category before deleting this one.', 409);
        changed = await client.query('DELETE FROM service_categories WHERE id=$1 RETURNING id,name,display_order,status', [categoryId]);
      } else throw new WorkspaceServicesError('CATEGORY_INVALID_ACTION', 'Category action is invalid.', 400);
      const category = changed.rows[0];
      await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
        VALUES($1,$2,'service_category',$3,$4::jsonb)`, [operator.operatorAdminId, `workspace.category_${action}`, category.id, JSON.stringify({ before, after: action === 'delete' ? null : category })]);
      await client.query('COMMIT');
      return { category: { id: Number(category.id), name: category.name, displayOrder: Number(category.display_order), status: category.status } };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      if (error.code === '23505') throw new WorkspaceServicesError('CATEGORY_DUPLICATE', 'A category with this name already exists.', 409);
      if (error.code === '23503') throw new WorkspaceServicesError('CATEGORY_IN_USE', 'This category is still used by a service.', 409);
      throw error;
    } finally { client.release(); }
  }
  return { requireAccess, list, mutate };
}

module.exports = { createWorkspaceServiceCategories, ...createWorkspaceServiceCategories() };
