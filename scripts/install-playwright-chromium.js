const { spawnSync } = require('node:child_process');

const DEFAULT_DOWNLOAD_CONNECTION_TIMEOUT_MS = '120000';

function createInstallPlan(environment = process.env) {
  return {
    command: process.execPath,
    args: [require.resolve('@playwright/test/cli'), 'install', '--only-shell', 'chromium'],
    env: {
      ...environment,
      PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:
        environment.PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT ||
        DEFAULT_DOWNLOAD_CONNECTION_TIMEOUT_MS,
    },
  };
}

function installPlaywrightChromium() {
  const plan = createInstallPlan();
  const result = spawnSync(plan.command, plan.args, {
    env: plan.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Unable to start the Playwright Chromium installer: ${result.error.message}`);
    return 1;
  }

  if (result.status !== 0) {
    console.error(
      [
        '',
        'Chromium could not be downloaded in this environment.',
        'The installer already requested the smaller headless browser and allowed a longer connection window.',
        "If the Playwright CDN is blocked, use Shiloh's required GitHub Playwright checks as the clean-browser authority.",
      ].join('\n'),
    );
    return result.status || 1;
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = installPlaywrightChromium();
}

module.exports = {
  DEFAULT_DOWNLOAD_CONNECTION_TIMEOUT_MS,
  createInstallPlan,
  installPlaywrightChromium,
};
