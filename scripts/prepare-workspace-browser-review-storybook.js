const fs = require('node:fs');
const path = require('node:path');
const review = require('../stories/fixtures/workspaceBrowserReview');
const { desktopDashboardHtml } = require('../stories/fixtures/workspaceDesktopLayout');
const { shortcutHtml } = require('../stories/fixtures/dashboardDepositWaiverShortcut');
const { rebookHtml } = require('../stories/fixtures/rebookActionPresentation');
const { dashboardDepositsHtml } = require('../stories/fixtures/workspaceDashboardDeposits');
const destination = path.resolve(__dirname, '../stories/fixtures/workspaceBrowserReview.generated');
fs.mkdirSync(destination, { recursive: true });
for (const [name, html] of [
  ['rebook-actions',rebookHtml()],
  ['waiver-shortcut-sparse',shortcutHtml('sparse')],['waiver-shortcut-busy',shortcutHtml('busy')],
  ['waiver-shortcut-restricted',shortcutHtml('sparse',false)],
  ['empty',review.calendarHtml(true)],['populated',review.calendarHtml(false)],
  ['messages',review.messagesHtml()],['dashboard',review.dashboardHtml()],
  ['clients',review.clientsHtml()],['rewards',review.rewardsHtml()],
  ['deposits-sparse',dashboardDepositsHtml('sparse')],['deposits-busy',dashboardDepositsHtml('busy')],
  ['desktop-sparse',desktopDashboardHtml('sparse')],['desktop-busy',desktopDashboardHtml('busy')],
]) fs.writeFileSync(path.join(destination, `${name}.html`),html);
