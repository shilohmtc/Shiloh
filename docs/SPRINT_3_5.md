# Sprint 3.5 — Goldie Knowledge Sync

> Historical implementation record. The generic `/admin/*` HTTP API and its `ADMIN_API_KEY`/`x-admin-key` authority were retired by #990. Manual endpoint calls below are no longer available; normal scheduled sync behavior remains independent of that retired surface.

Shiloh now treats the public Goldie booking page as an automatically refreshed business-knowledge source.

## Source

Default URL:

`https://book.heygoldie.com/Shiloh-Massage-Therapy-Clinic`

Override with `GOLDIE_SYNC_URL` if needed.

## Automatic refresh

- An initial sync is attempted about 15 seconds after the service starts.
- Shiloh checks the Goldie page every 12 hours by default.
- Override the interval with `GOLDIE_SYNC_INTERVAL_HOURS` (1–168).
- A SHA-256 content hash prevents unnecessary re-embedding when the page has not changed.
- When content changes, the previous Goldie knowledge document is replaced atomically so stale and duplicate Goldie entries do not accumulate.
- Sync failures are logged and do not stop WhatsApp handling.

## Protected admin endpoints

All endpoints require the existing `x-admin-key` header.

### Trigger a sync

`POST /admin/sync/goldie`

Optional JSON body:

```json
{ "force": true }
```

`force: true` re-indexes the page even when the content hash is unchanged.

### View sync status

`GET /admin/sync/goldie`

The response includes the last status, check time, successful sync time, content hash, source URL, and last error if any.

## Validation

1. Deploy and confirm `/health` returns database `ok`.
2. Wait about 15 seconds after startup.
3. Call `GET /admin/sync/goldie` and expect `last_status` to be `synced` or `unchanged`.
4. Ask Shiloh business questions that exist on Goldie, for example:
   - What are your Saturday opening hours?
   - What is your cancellation policy?
   - How much is the Full Body Swedish massage?
   - Do you offer couples treatments?
5. Update a harmless item on Goldie, then either wait for the scheduled check or call `POST /admin/sync/goldie`.
6. Confirm Shiloh answers using the updated business information.

## Source precedence

Sprint 3.4 rules still apply: Goldie is business knowledge. It must not overwrite personal facts stored in a user's structured profile.
