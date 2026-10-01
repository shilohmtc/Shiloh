#!/usr/bin/env node
// Read-only software/release inventory. Never loads application configuration or the DB.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

function command(program, args, cwd = process.cwd()) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout || '' };
}

function jsonCommand(args) {
  const result = command('npm', args);
  try {
    return { status: result.status, data: JSON.parse(result.stdout) };
  } catch {
    return { status: result.status, data: null };
  }
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: token
      ? { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      : { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Remote check unavailable');
  return response.json();
}

function deploymentStatus(entries, mainSha) {
  const live = entries
    .map((entry) => entry.deploy || entry)
    .find((deploy) => deploy.status === 'live');
  if (!live?.commit?.id || !mainSha) return { status: 'unknown' };
  return {
    status: live.commit.id === mainSha ? 'current' : 'different',
    commit: live.commit.id,
    deployId: live.id,
    finishedAt: live.finishedAt,
    latestStatus: (entries[0]?.deploy || entries[0])?.status,
  };
}

function dependencyReport(pkg, lock, outdated) {
  return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).map(
    ([name, requested]) => ({
      name,
      requested,
      locked: lock.packages?.[`node_modules/${name}`]?.version || null,
      wanted: outdated?.[name]?.wanted || null,
      latest: outdated?.[name]?.latest || null,
      updateAvailable: outdated ? Boolean(outdated[name]) : null,
    }),
  );
}

function snapshotEvidence(snapshot, outdir, commit) {
  if (
    snapshot.commit !== commit ||
    snapshot.restoreVerified !== true ||
    typeof snapshot.file !== 'string' ||
    path.basename(snapshot.file) !== snapshot.file
  )
    return { status: 'unverified' };
  const file = path.join(outdir, snapshot.file);
  if (!fs.existsSync(file)) return { status: 'unverified' };
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return sha256 === snapshot.sha256 ? snapshot : { status: 'unverified' };
}

function markdown(report) {
  const lines = [
    '# Shiloh maintenance check',
    '',
    `Checked: ${report.checkedAt}`,
    `Commit: ${report.repository.commit}`,
    '',
    `- Node: ${report.runtime.running}; project pin: ${report.runtime.required}; match: ${report.runtime.matches}`,
    `- Node release lookup: ${report.runtime.releaseLookup || 'unknown'}; latest same-major LTS: ${report.runtime.latestSameMajorLts || 'unknown'}`,
    `- Working copy: ${report.repository.workingCopy}; upstream: ${report.repository.upstream}`,
    `- Dependency lookup: ${report.dependencies.status}`,
    `- Production security audit: ${report.audit.status}`,
    `- All-package security audit (including development tools): ${report.toolingAudit?.status || 'unknown'}`,
    `- GitHub: ${report.github.status}`,
    `- Checkout matches current main: ${report.github.checkoutMatchesMain ?? 'unknown'}; open PRs observed: ${report.github.openPullRequests?.length ?? 'unknown'}`,
    `- Render commit alignment: ${report.render.status}`,
    `- Application/database health: ${report.health.status}`,
    `- Code snapshot: ${report.backups.codeSnapshot.status}`,
    '- Independent code backup: unverified',
    '- Database recovery: unverified',
    '- Uploaded-file recovery: unverified',
    '',
    '## Locked packages',
    '',
    '| Package | Locked | Wanted | Latest |',
    '| --- | --- | --- | --- |',
    ...report.dependencies.packages.map(
      (p) => `| ${p.name} | ${p.locked || 'unknown'} | ${p.wanted || '—'} | ${p.latest || '—'} |`,
    ),
    '',
    'Missing evidence is unknown, never healthy. Latest versions are information, not approval to install.',
    'This check does not upgrade, merge, deploy, migrate, send messages or access client records.',
    'GitHub-hosted snapshots expire and are not an independent backup. GitHub CI cannot see other computers’ uncommitted work.',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const outdir = path.resolve('artifacts/system-maintenance');
  fs.mkdirSync(outdir, { recursive: true });
  const git = (...args) => command('git', args);
  const dirty = git('status', '--porcelain', '--untracked-files=normal');
  const upstream = git('rev-list', '--left-right', '--count', 'HEAD...@{upstream}');
  const outdated = jsonCommand(['outdated', '--json', '--depth=0']);
  const audit = jsonCommand(['audit', '--omit=dev', '--json']);
  const counts = audit.data?.metadata?.vulnerabilities;
  const toolingAudit = jsonCommand(['audit', '--json']);
  const toolingCounts = toolingAudit.data?.metadata?.vulnerabilities;
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    repository: {
      commit: git('rev-parse', 'HEAD').stdout.trim(),
      workingCopy:
        dirty.status !== 0 ? 'unknown' : dirty.stdout.trim() ? 'changes-present' : 'clean',
      upstream: upstream.status === 0 ? upstream.stdout.trim().split(/\s+/).map(Number) : 'unknown',
      upstreamCountsOrder: ['ahead', 'behind'],
    },
    runtime: {
      running: process.versions.node,
      required: pkg.engines.node,
      matches: process.versions.node === pkg.engines.node,
    },
    dependencies: {
      status:
        outdated.data && [0, 1].includes(outdated.status) && !outdated.data.error
          ? 'checked'
          : 'unknown',
      packages: dependencyReport(pkg, lock, outdated.data?.error ? null : outdated.data),
    },
    audit: {
      status:
        counts && [0, 1].includes(audit.status)
          ? counts.high || counts.critical
            ? 'action-required'
            : 'no-high-or-critical-findings'
          : 'unknown',
      counts: counts || null,
    },
    toolingAudit: {
      status:
        toolingCounts && [0, 1].includes(toolingAudit.status)
          ? toolingCounts.high || toolingCounts.critical
            ? 'action-required'
            : 'no-high-or-critical-findings'
          : 'unknown',
      counts: toolingCounts || null,
      findings: Object.entries(toolingAudit.data?.vulnerabilities || {}).map(([name, finding]) => ({
        name,
        severity: finding.severity,
        direct: finding.isDirect,
        fixAvailable: Boolean(finding.fixAvailable),
      })),
    },
    github: { status: 'unconfigured' },
    render: { status: 'unconfigured' },
    health: { status: 'unknown' },
    backups: {
      codeSnapshot: { status: 'unverified' },
      independentCode: { status: 'unverified' },
      database: { status: 'unverified' },
      uploadedFiles: { status: 'unverified' },
    },
  };
  const repo = process.env.GITHUB_REPOSITORY || 'shilohmtc/Shiloh';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository');
  const api = `https://api.github.com/repos/${repo}`;
  report.runtime.workflowPins = fs
    .readdirSync('.github/workflows')
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => {
      const text = fs.readFileSync(path.join('.github/workflows', name), 'utf8');
      return [...text.matchAll(/node-version:\s*['"]?([\d.]+)/g)].map((match) => ({
        file: name,
        version: match[1],
        matches: match[1] === pkg.engines.node,
      }));
    });
  try {
    const releases = await getJson('https://nodejs.org/dist/index.json');
    const major = pkg.engines.node.split('.')[0];
    const latest = releases.find(
      (release) => release.lts && release.version.startsWith(`v${major}.`),
    );
    report.runtime.releaseLookup = latest ? 'checked' : 'unknown';
    report.runtime.latestSameMajorLts = latest?.version || null;
  } catch {
    report.runtime.releaseLookup = 'unknown';
  }
  const browsersPath = path.resolve('node_modules/playwright-core/browsers.json');
  report.playwright = fs.existsSync(browsersPath)
    ? {
        status: 'locked-browser-revisions',
        browsers: JSON.parse(fs.readFileSync(browsersPath, 'utf8')).browsers.map(
          ({ name, revision, browserVersion }) => ({ name, revision, browserVersion }),
        ),
        installationVerified: false,
      }
    : { status: 'unknown', installationVerified: false };
  try {
    const branch = await getJson(`${api}/branches/main`, process.env.GITHUB_TOKEN);
    const pulls = await getJson(`${api}/pulls?state=open&per_page=100`, process.env.GITHUB_TOKEN);
    const checks = await getJson(
      `${api}/commits/${branch.commit.sha}/check-runs?per_page=100`,
      process.env.GITHUB_TOKEN,
    );
    report.github = {
      status: 'checked',
      mainCommit: branch.commit.sha,
      checkoutMatchesMain: report.repository.commit === branch.commit.sha,
      openPullRequests: pulls.map((p) => ({
        number: p.number,
        head: p.head.sha,
        draft: p.draft,
        dependencyUpdate: p.user?.login === 'dependabot[bot]',
      })),
      pullRequestListMayBeTruncated: pulls.length === 100,
      checks: checks.check_runs.map((c) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
      })),
      checksTruncated: checks.total_count > checks.check_runs.length,
    };
  } catch {
    report.github = { status: 'unknown' };
  }
  if (process.env.RENDER_API_KEY) {
    try {
      const service = process.env.RENDER_SERVICE_ID || 'srv-d9qbfmk9v7es73emgam0';
      if (!/^srv-[a-z0-9]+$/.test(service)) throw new Error('Invalid service');
      const entries = await getJson(
        `https://api.render.com/v1/services/${service}/deploys?limit=20`,
        process.env.RENDER_API_KEY,
      );
      report.render = deploymentStatus(entries, report.github.mainCommit);
    } catch {
      report.render = { status: 'unknown' };
    }
  }
  try {
    const health = await getJson('https://app.shilohmtc.co.za/health');
    report.health = {
      status: health.status === 'ok' && health.database === 'ok' ? 'ok' : 'unexpected',
    };
  } catch {
    report.health = { status: 'unknown' };
  }
  const snapshotPath = path.join(outdir, 'code-snapshot.json');
  if (fs.existsSync(snapshotPath)) {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    // A previous or unrelated successful restore cannot establish this checkout's recovery.
    report.backups.codeSnapshot = snapshotEvidence(snapshot, outdir, report.repository.commit);
  }
  fs.writeFileSync(path.join(outdir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const summary = markdown(report);
  fs.writeFileSync(path.join(outdir, 'report.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
}

module.exports = { deploymentStatus, dependencyReport, snapshotEvidence, markdown };
if (require.main === module)
  main().catch(() => {
    console.error('Maintenance check failed; inspect its configuration.');
    process.exitCode = 1;
  });
