'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const run = promisify(execFile);
const { extractDocumentText, MAX_EXTRACTED_CHARS } = require('../src/services/documentParser');
const { syntheticDocx, sampleBody } = require('./helpers/syntheticDocx');
const mammothBin = path.join(path.dirname(require.resolve('mammoth/package.json')), 'bin/mammoth');

test('DOCX extraction preserves paragraphs, tables, Unicode and existing inline-break handling', async () => {
  const result = await extractDocumentText({ originalname: 'synthetic.DOCX', buffer: await syntheticDocx(sampleBody) });
  // Existing extractRawText joins an inline w:br; retain that baseline in this dependency-only change.
  const expected = 'Synthetic Shiloh guide\n\nFamily care: café & wellbeing.\tNextLine two\n\nTreatment\n\nR600';
  assert.deepEqual(result, { text: expected, extension: '.docx', extractedChars: expected.length });
});

test('empty, corrupt and oversized DOCX extraction retains existing refusals', async () => {
  await assert.rejects(extractDocumentText({ originalname: 'empty.docx', buffer: await syntheticDocx('<w:p/>') }), /did not contain readable text/);
  await assert.rejects(extractDocumentText({ originalname: 'broken.docx', buffer: Buffer.from('not a zip') }));
  const body = `<w:p><w:r><w:t>${'x'.repeat(MAX_EXTRACTED_CHARS + 1)}</w:t></w:r></w:p>`;
  await assert.rejects(extractDocumentText({ originalname: 'large.docx', buffer: await syntheticDocx(body) }), /character limit/);
});

test('plain text and Markdown normalization and upload validation remain unchanged', async () => {
  for (const ext of ['txt', 'md']) {
    const result = await extractDocumentText({ originalname: `synthetic.${ext}`, buffer: Buffer.from('  Café\u0000  \r\n\n\n\nGuide  ') });
    assert.equal(result.text, 'Café\n\n\nGuide');
  }
  await assert.rejects(extractDocumentText({ originalname: 'bad.exe', buffer: Buffer.from('x') }), /Unsupported file type/);
  await assert.rejects(extractDocumentText({}), /No upload file/);
});

test('Mammoth CLI help, required arguments and mutually exclusive output options remain usable', async () => {
  const { stdout } = await run(process.execPath, [mammothBin, '--help']);
  for (const flag of ['--output-dir', '--output-format', '--style-map', 'docx-path', 'output-path']) assert.ok(stdout.includes(flag));
  await assert.rejects(run(process.execPath, [mammothBin]), error => error.code === 2 && /required/.test(error.stderr));
  await assert.rejects(run(process.execPath, [mammothBin, 'synthetic.docx', 'out.html', '--output-dir', 'out']), error => error.code === 2 && /not allowed/.test(error.stderr));
});

test('Mammoth CLI retains stdout, Markdown file, output-directory and style-map conversion', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shiloh-docx-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'synthetic.docx');
  await fs.writeFile(input, await syntheticDocx(sampleBody));
  const html = await run(process.execPath, [mammothBin, input]);
  assert.match(html.stdout, /<h1>Synthetic Shiloh guide<\/h1>/);
  assert.match(html.stdout, /<table>.*R600/s);
  const markdown = path.join(dir, 'out.md');
  await run(process.execPath, [mammothBin, input, markdown, '--output-format', 'markdown']);
  assert.match(await fs.readFile(markdown, 'utf8'), /^# Synthetic Shiloh guide/);
  const styleMap = path.join(dir, 'style-map.txt');
  await fs.writeFile(styleMap, 'p.Heading1 => h2:fresh');
  await run(process.execPath, [mammothBin, input, '--output-dir', dir, '--style-map', styleMap]);
  assert.match(await fs.readFile(path.join(dir, 'synthetic.html'), 'utf8'), /<h2>Synthetic Shiloh guide<\/h2>/);
});
