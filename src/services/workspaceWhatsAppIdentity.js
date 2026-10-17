'use strict';
const crypto = require('node:crypto');
function workspaceWhatsAppRevision(admin) {
  return crypto.createHash('sha256').update(JSON.stringify([
    Number(admin.id), admin.normalized_whatsapp, admin.sign_in_first_name ?? null,
    admin.sign_in_surname ?? null, admin.sign_in_date_of_birth instanceof Date
      ? admin.sign_in_date_of_birth.toISOString().slice(0, 10) : admin.sign_in_date_of_birth ?? null,
  ])).digest('hex');
}
module.exports = { workspaceWhatsAppRevision };
