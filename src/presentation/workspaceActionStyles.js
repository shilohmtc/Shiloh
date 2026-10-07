const { WORKSPACE_ACTION_PALETTE, SHILOH_UX_TOKENS } = require('./shilohUxTokens');

// Explicit presenter roles only; client pages, statuses and booking colours are untouched.
function workspaceActionStyles() {
  const scope = ':is(.workspace-main,[data-workspace-payment])';
  const control = `${scope} :is([data-workspace-action],[data-calendar-action-tone])`;
  const roles = Object.entries(WORKSPACE_ACTION_PALETTE).map(([role, colour]) => {
    // Dense card selectors must not reduce the shared target size.
    const selector = `${control}[data-workspace-action][data-workspace-action="${role}"]`;
    return `${selector}{min-height:${SHILOH_UX_TOKENS.touch.minTarget};background:${colour.background};color:${colour.ink};border-color:${role === 'primary' ? colour.background : '#c9d4cc'}}${selector}:not(:disabled):not([aria-disabled="true"]):hover{background:${colour.hover}}`;
  }).join('');
  return `${control}{display:inline-flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;min-height:${SHILOH_UX_TOKENS.touch.minTarget};max-width:100%;padding:8px 12px;border:1px solid #c9d4cc;border-radius:9px;font-family:inherit;font-size:.8rem;font-weight:750;line-height:1.35;text-align:center;text-decoration:none;white-space:normal;overflow-wrap:anywhere;touch-action:manipulation}${roles}
${control}:disabled,${control}[aria-disabled="true"]{opacity:.5;cursor:not-allowed}
${scope} :is(a[href],button,summary,input,select,textarea):focus-visible{outline:3px solid ${SHILOH_UX_TOKENS.color.focus};outline-offset:3px}
${scope} :is(.tab,.preset-link,.view-tab,.filter).active,${scope} :is(.tab,.preset-link,.view-tab,.filter)[aria-current="page"],${scope} :is(.tab,.preset-link,.view-tab,.filter)[aria-pressed="true"]{background:#294c3c;color:#fff;border-color:#294c3c;box-shadow:inset 0 -3px 0 #b99972}
${scope} :is(.status-message,.finance-status,.operation-status):empty{min-height:0;margin-block:0;padding-block:0;border-width:0}
`;
}

module.exports = { workspaceActionStyles };
