const fs = require('node:fs');
const path = require('node:path');
const review = require('../stories/fixtures/workspaceBrowserReview');
const { desktopDashboardHtml } = require('../stories/fixtures/workspaceDesktopLayout');
const destination = path.resolve(__dirname, '../stories/fixtures/workspaceBrowserReview.generated');
fs.mkdirSync(destination, { recursive: true });
for (const [name, html] of [
  ['empty',review.calendarHtml(true)],['populated',review.calendarHtml(false)],
  ['messages',review.messagesHtml()],['dashboard',review.dashboardHtml()],
  ['clients',review.clientsHtml()],['rewards',review.rewardsHtml()],
  ['desktop-sparse',desktopDashboardHtml('sparse')],['desktop-busy',desktopDashboardHtml('busy')],
]) fs.writeFileSync(path.join(destination, `${name}.html`),html);
