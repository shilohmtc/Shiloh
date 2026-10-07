const { WORKSPACE_CARD_PALETTE, SHILOH_UX_TOKENS } = require('./shilohUxTokens');

// Only explicit pending-deposit cards and existing authorized Notes controls opt in.
function workspaceCardStyles() {
  const { depositPending, notes } = WORKSPACE_CARD_PALETTE;
  const card = ':is(.workspace-main,[data-workspace-payment]) [data-workspace-card="deposit-pending"]';
  const note = '.workspace-main .booking-notes-indicator';
  return `${card}{background:${depositPending.background};border-inline-start:3px solid ${depositPending.edge}}
${note}{display:inline-flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;min-height:${SHILOH_UX_TOKENS.touch.minTarget};min-width:${SHILOH_UX_TOKENS.touch.minTarget};padding:8px 12px;border:1px solid ${notes.edge};border-radius:9px;background:${notes.background};color:${notes.ink};font-family:inherit;font-size:.8rem;font-weight:750;line-height:1.35;text-decoration:none;cursor:pointer;touch-action:manipulation}
${note}:hover{background:${notes.hover}}
${note}:focus-visible{outline:3px solid ${SHILOH_UX_TOKENS.color.focus};outline-offset:3px}
.event-card .booking-notes-indicator{gap:6px;padding:8px;border-radius:8px;font:700 11px system-ui;line-height:1.35}
.workspace-main .positioned-event .event-card:has(.booking-notes-indicator){padding-inline-end:90px!important}
.workspace-main .positioned-event .booking-notes-indicator{position:absolute;inset-block-start:0;inset-inline-end:0;height:44px;max-width:86px}
.workspace-main .positioned-event .booking-notes-indicator:focus-visible{outline-offset:-3px}
@media(max-width:700px){.event-card .booking-notes-indicator span{display:none}.workspace-main .positioned-event .event-card:has(.booking-notes-indicator){padding-inline-end:48px!important}.workspace-main .positioned-event .booking-notes-indicator{width:44px;padding:8px}}
`;
}

module.exports = { workspaceCardStyles };
