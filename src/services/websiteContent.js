'use strict';

const { randomUUID } = require('node:crypto');
const { pool } = require('../db/pool');
const { resolveCalendarAuthority } = require('./calendarAuthorization');
const { WebsiteContentError, normalizeDocument, visibleDocument } = require('../domain/websiteContent');

function uuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))) throw new WebsiteContentError('WEBSITE_NOT_FOUND', 'That website item was not found.', 404);
  return String(value);
}
function imageMime(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > 2 * 1024 * 1024) throw new WebsiteContentError('WEBSITE_IMAGE_SIZE', 'Choose an image no larger than 2 MB.', 413);
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  throw new WebsiteContentError('WEBSITE_IMAGE_TYPE', 'Choose a JPEG, PNG or WebP image.');
}
function createWebsiteContentService({ db = pool, now = () => new Date(), authorize = resolveCalendarAuthority } = {}) {
  async function resolveAccess(adminId, queryable = db) {
    const principal = await authorize(queryable, adminId);
    const a = principal?.calendarAuthority;
    return a && ['owner','business_admin'].includes(a.businessRole) && a.calendarScope === 'all_business' && a.serviceScope === 'all_services' ? a : null;
  }
  async function requireAccess(queryable, adminId) {
    const authority = await resolveAccess(adminId, queryable);
    if (!authority) throw new WebsiteContentError('WEBSITE_ACCESS_DENIED', 'Website publishing is available to clinic administrators.', 403);
    return authority;
  }
  async function publicPosts({ kind = null } = {}) {
    const rows = (await db.query(`SELECT id,slug,kind,rule_code,published FROM website_content_posts
      WHERE published IS NOT NULL AND ($1::text IS NULL OR kind=$1) ORDER BY published_at DESC NULLS LAST,id`, [kind])).rows;
    return rows.map(row => visibleDocument(row, now())).filter(Boolean);
  }
  async function publicPost(kind, slug) {
    if (!['episode','offer'].includes(kind) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug)) || slug.length > 120) return null;
    const row = (await db.query('SELECT id,slug,kind,rule_code,published FROM website_content_posts WHERE kind=$1 AND slug=$2', [kind, slug])).rows[0];
    return visibleDocument(row, now());
  }
  async function model({ adminId } = {}) {
    await requireAccess(db, adminId);
    return { posts:(await db.query('SELECT id,slug,kind,rule_code,draft,published,revision,updated_at FROM website_content_posts ORDER BY kind,updated_at DESC,id')).rows };
  }
  async function transact(adminId, action) {
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      await requireAccess(connection, adminId);
      const value = await action(connection);
      await connection.query('COMMIT');
      return value;
    } catch (error) { await connection.query('ROLLBACK').catch(() => {}); throw error; }
    finally { connection.release(); }
  }
  async function assertImage(connection, doc) {
    if (doc.imageId && !(await connection.query('SELECT id FROM website_content_media WHERE id=$1', [doc.imageId])).rowCount) throw new WebsiteContentError('WEBSITE_IMAGE_MISSING', 'Upload the image again before saving.');
  }
  async function record(connection, post, action, adminId) {
    await connection.query(`INSERT INTO website_content_revisions(post_id,action,revision,document,actor_admin_id)
      VALUES($1,$2,$3,$4::jsonb,$5)`, [post.id, action, post.revision, JSON.stringify(post.draft), adminId]);
  }
  async function createEpisode({ adminId, document } = {}) {
    const doc = normalizeDocument(document, 'episode');
    return transact(adminId, async connection => {
      await assertImage(connection, doc);
      const id = randomUUID();
      const slug = `episode-${doc.episode}-${id.slice(0,8)}`;
      const post = (await connection.query(`INSERT INTO website_content_posts(id,slug,kind,draft,updated_by)
        VALUES($1,$2,'episode',$3::jsonb,$4) RETURNING *`, [id, slug, JSON.stringify(doc), adminId])).rows[0];
      await record(connection, post, 'create', adminId);
      return post;
    });
  }
  async function edit({ adminId, postId, revision, action = 'save', document, restoreRevision } = {}) {
    uuid(postId);
    if (!Number.isSafeInteger(Number(revision)) || Number(revision) < 1 || !['save','publish','unpublish','restore'].includes(action)) throw new WebsiteContentError('WEBSITE_REQUEST_INVALID', 'Reload the editor and try again.');
    if (action === 'restore' && (!Number.isSafeInteger(Number(restoreRevision)) || Number(restoreRevision) < 1)) throw new WebsiteContentError('WEBSITE_REQUEST_INVALID', 'Choose a saved version to restore.');
    return transact(adminId, async connection => {
      const row = (await connection.query('SELECT * FROM website_content_posts WHERE id=$1 FOR UPDATE', [postId])).rows[0];
      if (!row) throw new WebsiteContentError('WEBSITE_NOT_FOUND', 'That website item was not found.', 404);
      if (row.revision !== Number(revision)) throw new WebsiteContentError('WEBSITE_REVISION_CHANGED', 'Someone saved a newer version. Reload before making changes.', 409);
      let nextDocument = document;
      if (action === 'restore') {
        const historic = (await connection.query('SELECT document FROM website_content_revisions WHERE post_id=$1 AND revision=$2', [postId, Number(restoreRevision)])).rows[0];
        if (!historic) throw new WebsiteContentError('WEBSITE_REVISION_MISSING', 'That saved version is unavailable.', 404);
        nextDocument = historic.document;
      }
      const doc = action === 'unpublish' ? row.draft : normalizeDocument(nextDocument, row.kind);
      await assertImage(connection, doc);
      if (action === 'publish') {
        if (doc.endsAt && Date.parse(doc.endsAt) <= now().getTime()) throw new WebsiteContentError('WEBSITE_DATES_PASSED', 'Choose a future end date or leave the end blank.');
        if (row.kind === 'offer' && row.rule_code !== 'morning_welcome_v1') throw new WebsiteContentError('WEBSITE_PRICING_REQUIRED', 'This offer needs its booking price configured before publication.', 409);
      }
      const published = action === 'publish' ? doc : action === 'unpublish' ? null : row.published;
      const post = (await connection.query(`UPDATE website_content_posts SET draft=$2::jsonb,published=$3::jsonb,
        revision=revision+1,updated_by=$4,updated_at=NOW(),published_at=CASE WHEN $5='publish' THEN NOW() WHEN $5='unpublish' THEN NULL ELSE published_at END WHERE id=$1 RETURNING *`, [postId, JSON.stringify(doc), published ? JSON.stringify(published) : null, adminId,action])).rows[0];
      await record(connection, post, action, adminId);
      return post;
    });
  }
  async function uploadImage({ adminId, bytes } = {}) {
    const mime = imageMime(bytes);
    return transact(adminId, async connection => {
      const id = randomUUID();
      await connection.query('INSERT INTO website_content_media(id,mime_type,bytes,created_by) VALUES($1,$2,$3,$4)', [id, mime, bytes, adminId]);
      return { id, url:`/website-media/${id}` };
    });
  }
  async function media({ id, adminId = null } = {}) {
    uuid(id);
    if (adminId != null) await requireAccess(db, adminId);
    else {
      const visible = await db.query(`SELECT 1 FROM website_content_posts WHERE published->>'imageId'=$1
        AND (published->>'startsAt' IS NULL OR (published->>'startsAt')::timestamptz<=$2)
        AND (published->>'endsAt' IS NULL OR (published->>'endsAt')::timestamptz>$2) LIMIT 1`, [id,now()]);
      if (!visible.rowCount) return null;
    }
    return (await db.query('SELECT mime_type,bytes FROM website_content_media WHERE id=$1', [id])).rows[0] || null;
  }
  async function history({ adminId, postId } = {}) {
    await requireAccess(db, adminId); uuid(postId);
    return (await db.query(`SELECT revision,action,document,created_at FROM website_content_revisions
      WHERE post_id=$1 ORDER BY revision DESC LIMIT 30`, [postId])).rows;
  }
  return { resolveAccess, model, createEpisode, edit, uploadImage, media, history, publicPosts, publicPost };
}
module.exports = { createWebsiteContentService, imageMime, uuid };
