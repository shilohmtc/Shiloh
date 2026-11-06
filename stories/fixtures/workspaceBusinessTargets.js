const { METRICS, comparison } = require('../../src/domain/workspaceBusinessTargets');
function targetsFixture({ unset = false } = {}) {
  return {
    month: '2026-11',
    asOf: '2026-11-06T08:00:00Z',
    metrics: Object.entries(METRICS).map(([key, meta], i) => ({
      key,
      ...meta,
      ...comparison(i ? 24 : 1800000, unset ? null : i ? 120 : 9000000),
      revision: unset ? 0 : 1,
    })),
    history: unset
      ? []
      : [
          {
            metric: 'net_receipts',
            action: 'set',
            target_value: 9000000,
            revision: 1,
            created_at: '2026-11-01T08:00:00Z',
            actor_name: 'Synthetic owner',
          },
        ],
    hasMoreHistory: false,
  };
}
module.exports = { targetsFixture };
