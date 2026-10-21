'use strict';

const { createRequire } = require('node:module');
const JSZip = createRequire(require.resolve('mammoth'))('jszip');

async function syntheticDocx(body) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const sampleBody = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Synthetic Shiloh guide</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t>Family care: café &amp; wellbeing.</w:t><w:tab/><w:t>Next</w:t><w:br/><w:t>Line two</w:t></w:r></w:p>'
  + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Treatment</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>R600</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

module.exports = { syntheticDocx, sampleBody };
