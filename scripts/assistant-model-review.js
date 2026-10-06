'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fixtures = require('../tests/fixtures/assistant-model-review.json');
const { MODELS, MAX_REQUESTS_PER_CASE, MAX_OUTPUT_TOKENS, buildCaseRequest, evaluateCase } = require('./lib/assistant-model-evaluation');

async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['--dry-run', '--live'].includes(args[0])) {
    throw new Error('Usage: node scripts/assistant-model-review.js --dry-run|--live');
  }
  const live = args[0] === '--live';
  if (!fixtures.synthetic || !fixtures.cases.length) throw new Error('Synthetic evaluation fixtures are required');
  for (const model of MODELS) for (const scenario of fixtures.cases) buildCaseRequest(model, scenario);
  const report = {
    generatedAt: new Date().toISOString(),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(),
    mode: live ? 'live_synthetic' : 'dry_run',
    models: MODELS,
    caseIds: fixtures.cases.map(scenario => scenario.id),
    maxRequests: MODELS.length * fixtures.cases.length * MAX_REQUESTS_PER_CASE,
    maxOutputTokensPerRequest: MAX_OUTPUT_TOKENS,
    decision: 'pending_live_evidence_and_human_review',
    results: [],
  };
  if (live) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY must be available securely in the execution environment');
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 45000 });
    for (let index = 0; index < fixtures.cases.length; index += 1) {
      // Alternate ordering to reduce systematic timing/cache bias; never share conversations.
      const models = index % 2 ? [...MODELS].reverse() : MODELS;
      for (const model of models) {
        const result = await evaluateCase({ responses: client.responses, model, scenario: fixtures.cases[index] });
        report.results.push(result);
        console.log(`${model} / ${result.caseId}: ${result.screening.passed ? 'screening passed' : 'review needed'}`);
        if (result.error?.startsWith('api_')) break;
      }
      if (report.results.some(result => result.error?.startsWith('api_'))) break;
    }
    report.complete = report.results.length === MODELS.length * fixtures.cases.length;
    report.screeningPassed = report.complete && report.results.every(result => result.screening.passed);
  }
  const directory = path.join(__dirname, '..', 'artifacts', 'assistant-model-review');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const output = path.join(directory, 'latest.json');
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${live ? 'Synthetic comparison' : 'Offline preflight'} saved: ${output}`);
  console.log('Human review is required. This runner does not select or deploy a model.');
  if (live && !report.screeningPassed) process.exitCode = 1;
  return report;
}

if (require.main === module) main().catch(() => {
  console.error('Evaluation could not finish. Check arguments, synthetic fixtures and securely configured OPENAI_API_KEY.');
  process.exitCode = 1;
});

module.exports = { main };
