import depositsSparse from './fixtures/workspaceBrowserReview.generated/deposits-sparse.html?url';
import depositsBusy from './fixtures/workspaceBrowserReview.generated/deposits-busy.html?url';
// Generated from the exact production presenters and fabricated models before each build.
import empty from './fixtures/workspaceBrowserReview.generated/empty.html?url';
import populated from './fixtures/workspaceBrowserReview.generated/populated.html?url';
import messages from './fixtures/workspaceBrowserReview.generated/messages.html?url';
import dashboard from './fixtures/workspaceBrowserReview.generated/dashboard.html?url';
import clients from './fixtures/workspaceBrowserReview.generated/clients.html?url';
import rewards from './fixtures/workspaceBrowserReview.generated/rewards.html?url';
import sparse from './fixtures/workspaceBrowserReview.generated/desktop-sparse.html?url';
import busy from './fixtures/workspaceBrowserReview.generated/desktop-busy.html?url';
const iframe = url => `<iframe title="Synthetic browser review" style="width:100%;height:100vh;border:0" src="${url}"></iframe>`;
export default { title: 'Workspace/Browser Review' };
export const EmptyTeamDay = { render: () => iframe(empty) };
export const PopulatedTeamDay = { render: () => iframe(populated) };
export const MessagesDateObject = { render: () => iframe(messages) };
export const TodayCounts = { render: () => iframe(dashboard) };
export const SearchFirstClients = { render: () => iframe(clients) };
export const RewardsFields = { render: () => iframe(rewards) };
export const DesktopSparseDay = { render: () => iframe(sparse) };
export const DesktopBusyDay = { render: () => iframe(busy) };

export const DepositsBelowTodaySparse = { render: () => iframe(depositsSparse) };
export const DepositsBelowTodayBusy = { render: () => iframe(depositsBusy) };
