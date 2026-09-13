const base = require('./workspaceClientsManageUx');

function injectClientDetailManagement(html, model) {
  let rendered = base.injectClientDetailManagement(html, model);
  if (model?.manageAllowed === true && model?.archiveAllowed !== true) {
    rendered = rendered
      .replace(/<button class="button danger" type="button" data-client-archive>Archive client<\/button>/, '')
      .replace(
        'Changing the mobile resets canonical mobile verification. Archive is reversible at the data layer but Restore is intentionally not part of Clients Write V1; appointment history is preserved and there is no hard-delete action.',
        'Changing the mobile resets canonical mobile verification. Practitioner client maintenance is limited to create and profile updates; archive and delete actions are not available.',
      );
  }
  return rendered;
}

module.exports = {
  ...base,
  injectClientDetailManagement,
};
