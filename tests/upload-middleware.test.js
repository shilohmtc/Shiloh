const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { documentUpload, MAX_UPLOAD_BYTES } = require('../src/middleware/documentUpload');
const { csvUpload, MAX_CSV_UPLOAD_BYTES } = require('../src/middleware/csvUpload');

async function serve(t, middleware) {
  const app = express();
  app.post('/upload', (req, res, next) => {
    req.id = 'synthetic-upload';
    next();
  }, middleware, (req, res) => res.json({
    name: req.file.originalname,
    size: req.file.size,
    memory: Buffer.isBuffer(req.file.buffer),
    diskPath: req.file.path || null,
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}/upload`;
}

async function send(url, files) {
  const form = new FormData();
  for (const { name, size = 12, field = 'file' } of files) {
    form.append(field, new Blob([Buffer.alloc(size, 65)]), name);
  }
  const response = await fetch(url, { method: 'POST', body: form });
  return { status: response.status, body: await response.json() };
}

for (const { label, middleware, name, limit, invalid } of [
  { label: 'documents', middleware: documentUpload, name: 'synthetic.TXT', limit: MAX_UPLOAD_BYTES, invalid: 'synthetic.exe' },
  { label: 'CSV', middleware: csvUpload, name: 'synthetic.CSV', limit: MAX_CSV_UPLOAD_BYTES, invalid: 'synthetic.txt' },
]) {
  test(`${label}: accepted upload stays in memory`, async t => {
    const url = await serve(t, middleware);
    const result = await send(url, [{ name }]);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { name, size: 12, memory: true, diskPath: null });
  });

  test(`${label}: oversized upload preserves the 413 response`, async t => {
    const url = await serve(t, middleware);
    const result = await send(url, [{ name, size: limit + 1 }]);
    assert.equal(result.status, 413);
    assert.match(result.body.error, /upload limit/);
    assert.equal(result.body.requestId, 'synthetic-upload');
  });

  test(`${label}: unsupported extension is rejected`, async t => {
    const url = await serve(t, middleware);
    const result = await send(url, [{ name: invalid }]);
    assert.equal(result.status, 400);
    assert.equal(result.body.requestId, 'synthetic-upload');
  });

  test(`${label}: extra file and unexpected field are rejected`, async t => {
    const url = await serve(t, middleware);
    for (const files of [[{ name }, { name }], [{ name, field: 'unexpected' }]]) {
      const result = await send(url, files);
      assert.equal(result.status, 400);
      assert.equal(result.body.requestId, 'synthetic-upload');
    }
  });
}
