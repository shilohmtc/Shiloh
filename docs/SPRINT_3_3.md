# Sprint 3.3 — Intelligent user profiles

> Historical implementation record. The generic `/admin/*` HTTP API and its `ADMIN_API_KEY`/`x-admin-key` authority were retired by #990. The endpoints and Postman step below are not current Shiloh operating instructions.

## What this adds

Shiloh now stores durable structured user profiles in PostgreSQL and injects relevant profile facts into GPT responses.

Profile fields:
- phone
- name
- preferred language
- location
- preferences (JSON)
- customer status
- tags
- custom attributes (JSON)
- last interaction timestamp

## Automatic profile capture

The WhatsApp message processor captures explicit facts such as:

- `My name is Christel`
- `I live in Cape Town`
- `My favourite colour is green`
- `My preferred language is English`

Only explicit phrases are captured automatically. The extractor deliberately avoids guessing implicit personal facts.

## Protected admin endpoints

All routes use the existing `x-admin-key` authentication.

- `GET /admin/profiles`
- `GET /admin/profiles/:phone`
- `PATCH /admin/profiles/:phone`

Example PATCH body:

```json
{
  "customerStatus": "active",
  "tags": ["vip", "massage"],
  "preferences": {
    "appointment_time": "morning"
  }
}
```

## End-to-end WhatsApp test

1. Send: `My name is ProfileTestUser`.
2. Send: `I live in Stellenbosch`.
3. Send: `My favourite drink is rooibos tea`.
4. Restart or redeploy the Render service.
5. Ask: `What is my name, where do I live, and what is my favourite drink?`
6. Confirm Shiloh returns the saved profile facts.
7. In Postman, call `GET /admin/profiles` with `x-admin-key` and confirm the profile exists.

Conversation memory and the knowledge-base RAG system remain active alongside structured profiles.
