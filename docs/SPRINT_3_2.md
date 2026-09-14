# Sprint 3.2 — Real document ingestion

> Historical implementation record. The generic `/admin/*` HTTP API and its `ADMIN_API_KEY`/`x-admin-key` authority were retired by #990. The endpoints and Postman steps below are not current Shiloh operating instructions.

## Supported files

- PDF (`.pdf`)
- Microsoft Word (`.docx`)
- Plain text (`.txt`)
- Markdown (`.md`)

Uploads are held in memory only while text is extracted. The original file is not persisted. The extracted text is chunked, embedded, and stored in PostgreSQL/pgvector through the existing knowledge service.

## Limits

- One file per request
- 10 MB maximum upload size
- 300,000 maximum extracted characters
- Protected by the existing `x-admin-key` header

## Upload endpoint

`POST /admin/documents/upload`

Use `multipart/form-data` with:

- `file` — required file
- `title` — optional display title; defaults to the filename without extension
- `source` — optional source label; defaults to the original filename

## Postman test

1. Create a POST request to `https://app.shilohmtc.co.za/admin/documents/upload`.
2. Add the `x-admin-key` header with the configured Render `ADMIN_API_KEY` value.
3. Open Body → form-data.
4. Add a key named `file`, change its type from Text to File, and select a PDF/DOCX/TXT/MD file.
5. Optionally add Text fields named `title` and `source`.
6. Send the request.
7. Expect HTTP 201 with document metadata, chunk count, uploaded byte size, and extracted character count.
8. Ask Shiloh a WhatsApp question whose answer exists only in the uploaded document.

## Existing management endpoints

- `GET /admin/documents` — list indexed documents
- `DELETE /admin/documents/:id` — delete a document and its chunks
- `POST /admin/documents` — existing raw JSON ingestion endpoint
