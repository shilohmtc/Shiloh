# Controlled trial only

Not for adoption or deployment. Normal Playwright config and release workflows are unchanged.
Run six complete suites in order 1,2,2,1,1,2 on one ubuntu-latest runner, same immutable commit and built Storybook. Keep assertions, test selection, snapshot thresholds, timeouts and retries unchanged. Three repetitions per mode expose order and run variation; compare median/range and every failure/retry, not only fastest runs. Python resource usage records CPU, peak RSS, faults and context switches; runner CPU and memory capacity are recorded too. This is an initial resource-contention signal, not complete browser-process profiling.

Workers use independent local source clones (for git-bound evidence), temporary directories and fixed-path artifacts. Playwright output is unique per run/test; shared Storybook only serves static files. Snapshot expectations remain the original committed fixtures and are never updated. No database credentials are passed to trial test processes. Servers use ephemeral local ports; Playwright browser contexts are test-scoped. Per-file sequential scheduling remains unchanged (`fullyParallel: false`).

Compare test-list.txt and JSON results by file/title/project, status and retry. Review screenshots from both modes and baseline assertion outcomes before recommending adoption. Any worker-isolation failure, changed test inventory, unexplained flake or missing evidence blocks recommendation. This draft must not merge. Local SHILOH_TRIAL_SMOKE=1 runs only two focused files to validate infrastructure and cannot support a speed claim.
