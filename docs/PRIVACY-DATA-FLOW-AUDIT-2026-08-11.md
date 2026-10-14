# Shiloh OS — Privacy & Data-Flow Audit — 11 Aug 2026


> Historical audit of the platform on 11 August 2026. Current retirement note, 14 October 2026: automated WhatsApp conversations and delivery are retired. The mounted webhook acknowledges inbound messages and retains historical delivery-status evidence; clients contact human Reception directly. Passkeys/SMS and current My Shiloh/Workspace flows remain separate. The old language/onboarding guards, human-handoff writer, staff routing adapter and unused template-status readers described by historical work are removed from runtime. This note does not mean current app AI processing or historical processor/retention obligations have ended. See the current integration map in [SHILOH_PLATFORM_HANDBOOK.md](SHILOH_PLATFORM_HANDBOOK.md).
## Status and scope

This is an engineering/privacy architecture audit of the current Shiloh OS code and production infrastructure. It is not a legal certification of POPIA compliance.

Authoritative sources for this audit are GitHub `main`, Render production metadata, the Shiloh CRM schema/code paths, and current provider/regulatory documentation. No identifiable production client rows were read for this audit.

## Executive assessment

Shiloh has strong foundations: canonical client/contact separation, staff-scoped authorization, masked WhatsApp phone logging, secret redaction, deterministic workflow handling before the general conversational model, CRM audit events, and a safe self-test-first production discipline.

The main privacy gaps are now governance and minimisation rather than basic security architecture:

1. AI context is broader than necessary: general conversational replies include all profile `custom_attributes`, and arbitrary preference values may also enter model context.
2. The OpenAI Responses conversation path intentionally uses `store:true` plus `previous_response_id`; Shiloh stores the corresponding response ID against a phone number with no local TTL.
3. General knowledge retrieval embeds the user's incoming message before retrieval, so that message is also transmitted to OpenAI's embeddings endpoint.
4. The English-language guard sends eligible incoming messages to OpenAI before most deterministic workflow routing, although it correctly uses `store:false`.
5. Google Calendar events currently include client name, treatment/service, practitioner, time and location. Treatment/service names can sometimes reveal or imply sensitive wellness/health information and should be minimised where operationally possible.
6. The current admin `Delete client` command archives rather than erases or anonymises. Shiloh therefore lacks a dedicated privacy/data-subject deletion workflow that can distinguish records that must legitimately be retained from records that should be erased or de-identified.
7. Temporary onboarding/walk-in session records and conversation-session mappings have no explicit retention lifecycle in the inspected code.
8. Historical Goldie provenance/staging data still needs a purpose-and-retention classification now that Goldie is retired from the active booking stack.
9. Production compute and PostgreSQL are currently hosted in Render's Oregon region, so cross-border processing must be documented and assessed under POPIA rather than assumed to be local South African processing.
10. Shiloh must not allow future medical/health information to drift into generic `preferences`, `tags`, `custom_attributes`, conversation memory or general AI context. Any health/intake domain requires a deliberately separate design and review.

## Confirmed production infrastructure

### Render web service

- Service: `shiloh-whatsapp-bot`
- Runtime: Node
- Branch: `main`
- Auto-deploy: enabled on commit
- Build: `npm ci`
- Start: `npm start`
- Health path: `/health`
- Region: Oregon
- Plan: Starter

### Render PostgreSQL

- Database: `shiloh-memory`
- Database name: `shiloh_memory`
- PostgreSQL: 18
- Region: Oregon
- Plan: Free
- High availability: disabled
- Disk autoscaling: disabled

The Render read-only SQL connector currently fails because its connection path does not negotiate the database's required SSL/TLS. No production client rows or unverified SQL results are claimed from that connector.

## Data inventory

### Canonical client identity

`clients` contains:

- display name
- preferred language
- status
- preferences JSON
- tags
- custom attributes JSON
- source/provenance
- date of birth
- timestamps

`client_contacts` contains:

- WhatsApp/mobile/email/other contact values
- normalized contact values
- primary-contact flag
- verification timestamp
- timestamps

### Onboarding and walk-in staging

`client_onboarding_sessions` can contain:

- phone
- client ID
- pending name
- pending contact
- pending date of birth
- booking-requested flag
- workflow state and timestamps

`walkin_registration_sessions` can contain:

- staff/admin ID
- pending name
- pending phone
- pending date of birth
- workflow state and timestamps

### Conversational/profile data

`user_profiles` can contain:

- phone
- name
- preferred language
- location
- preferences JSON
- customer status
- tags
- custom attributes JSON
- last interaction and timestamps

`conversation_sessions` contains:

- phone
- OpenAI response ID
- updated timestamp

### Booking/operational data

The wider CRM includes client-linked appointments, service snapshots, practitioner assignments, status history, pricing/currency, calendar blocks, booking/change intents, loyalty/customer-care records, consent/policy state, audit events and historical migration/provenance records.

## External data flows

### Meta / WhatsApp

At the audit date, client messages and identifiers originated through the Meta WhatsApp Cloud API and outbound Shiloh replies used that provider. Those automated conversation and sending paths have since retired; historical delivery-status callbacks remain. Meta is therefore part of the end-to-end personal-information processing chain and its contractual/data-location terms must be kept in Shiloh's processor/subprocessor register.

### Render

Render hosts the public Node application and PostgreSQL database. The confirmed web service and database are in Oregon. Render therefore stores/processes Shiloh operational and CRM data outside South Africa.

### OpenAI — language classification

Historically, before WhatsApp workflow routing, `englishLanguageGuard` could transmit up to 700 characters of an incoming WhatsApp message to the configured fast OpenAI model. This request uses `store:false`. The guard is now removed and this WhatsApp language-classification flow no longer runs. Current app AI flows require their own processor assessment.

### OpenAI — knowledge retrieval embeddings

For messages that reach the general conversational AI path, `retrieveKnowledge(message)` creates an embedding of the incoming client message using OpenAI before searching Shiloh's local vector knowledge base.

### OpenAI — conversational response

For the general conversational path, Shiloh transmits:

- the client's current message;
- selected business knowledge retrieved for the message;
- active catalogue knowledge;
- structured profile context; and
- a previous OpenAI response ID when present.

The current profile context includes name, preferred language, location, all stored preferences, customer status, tags and all `custom_attributes`.

The current response request sets `store:true`, and the returned response ID is persisted in `conversation_sessions` for subsequent `previous_response_id` use.

### Google Calendar

Booking events currently transmit/display:

- client name;
- service/treatment name;
- practitioner;
- start/end time;
- location where present;
- internal Shiloh appointment ID/source metadata.

Service/treatment names should be treated as potentially sensitive contextual information where they can imply a health, pregnancy, intimate, or aesthetic condition.

## Logging and observability

Positive controls observed:

- webhook logs mask WhatsApp phone numbers to their last four digits;
- incoming message text is not intentionally logged by the webhook;
- Pino redacts authorization values, WhatsApp token, OpenAI API key and database URL;
- OpenAI usage logging records model/response ID/token counts rather than prompt text.

Remaining review:

- provider/API error objects should be reviewed to ensure they cannot echo request bodies or personal information into logs;
- formal Render log retention and access policy should be recorded in the governance register.

## Retention / deletion assessment

### Current behavior

- Canonical CRM/history is retained unless separately altered.
- `Delete client` currently changes the client to inactive and preserves the CRM record and appointment history for audit purposes.
- `conversation_sessions` has a `clearSession` function but no inspected automatic expiry policy.
- onboarding/walk-in staging tables have timestamps but no inspected automatic expiry policy.
- OpenAI conversation state is intentionally used by the general assistant via stored response IDs.

### Required target state

Create an explicit retention matrix covering at least:

| Data class | Target policy |
| --- | --- |
| Incomplete onboarding sessions | Short-lived automatic expiry |
| Incomplete walk-in sessions | Short-lived automatic expiry |
| OpenAI conversation-session mapping | Defined short operational window |
| User-profile convenience memory | Purpose-limited; remove stale/unneeded attributes |
| Canonical identity/contact | Retain while a legitimate business/legal purpose exists |
| Appointment/transaction history | Retain according to documented business/legal obligation |
| DOB | Retain only while the registration/birthday/identity purpose is justified |
| Booking/change intents | Short/medium operational retention |
| Consent/policy/audit events | Longer controlled retention where needed as evidence |
| Historical Goldie staging/provenance | Classify record-by-record/table-by-table; delete migration residue when no longer justified |
| Health/intake data if introduced | Separate strict policy and architecture review |

A privacy deletion request must not be implemented as indiscriminate cascading deletion. The workflow must identify which records Shiloh remains authorised/obliged to retain, then erase or de-identify everything else and record the decision without reintroducing the deleted personal data into the audit trail.

## AI minimisation policy

Effective immediately as an architecture rule:

1. Never place medical/health data in generic profile `preferences`, `tags`, `custom_attributes`, conversation memory or business knowledge.
2. Opaque/arbitrary `custom_attributes` must not be automatically included in general LLM context.
3. Preference fields sent to an LLM should be allowlisted by purpose, not included simply because they exist.
4. Deterministic CRM/booking/admin flows should remain local where practical and should not invoke a model merely to transport or restate structured personal data.
5. Classifiers should use `store:false` unless persistent state is genuinely required.
6. Where persistent AI conversation state is required, its purpose and maximum operational lifetime must be documented and enforced.
7. Do not ingest client records or conversation transcripts into the business-knowledge/vector-document system.

## Google Calendar minimisation target

The CRM remains the authoritative detailed booking record. Calendar should carry only the information staff need to operate the diary.

Proposed target, subject to operational validation:

- summary: client-identifying label + practitioner, without treatment detail where practicable;
- description: avoid treatment/service and other sensitive detail unless a demonstrated operational need exists;
- internal appointment ID may remain in private extended properties for reconciliation;
- access remains practitioner/role scoped.

Do not change production calendar presentation until a synthetic test proves that booking create/update/cancel/reconciliation behavior remains correct and staff usability is preserved.

## POPIA governance work required

Maintain these artifacts as part of Shiloh OS operations:

1. Data inventory / record of processing activities.
2. Purpose and lawful-processing basis for each data category/workflow.
3. Operator/provider register: Meta, Render, OpenAI, Google and any future payment/communications provider.
4. Cross-border transfer assessment for foreign processing/storage.
5. Retention and secure-destruction schedule.
6. Data-subject request procedure covering access, correction, objection, deletion/destruction and response tracking.
7. Information Officer / Deputy Information Officer responsibilities and registration status.
8. Security-compromise runbook and notification procedure.
9. Access-control review process for clinic staff and connected service accounts.
10. Health/special-personal-information gate: no new health-data feature goes live without a dedicated design/privacy review.
11. Privacy notice/transparency review for registration, WhatsApp assistance, calendar processing, AI assistance and birthday/direct-marketing workflows.
12. Periodic privacy regression review alongside security/CI checks.

## Priority remediation sequence

### P-PRIV-1 — Immediate AI minimisation

- Remove arbitrary `custom_attributes` from general LLM context.
- Add regression tests proving sensitive/opaque attributes are excluded.
- Review/allowlist profile preference fields before sending them to the model.

### P-PRIV-2 — AI state and retrieval retention

- Document the exact OpenAI endpoint retention behavior in the provider register.
- Decide an operational conversation-memory window.
- Expire stale local `conversation_sessions`.
- Evaluate migration to stateless/locally managed short context with `store:false`, or eligibility for stricter OpenAI retention controls, without degrading the client experience.
- Confirm that client content is never ingested as permanent knowledge documents.

### P-PRIV-3 — Temporary-data retention

- Implement cleanup for abandoned onboarding and walk-in sessions.
- Add non-mutating tests for expiry selection/cleanup logic.

### P-PRIV-4 — Data-subject rights lifecycle

- Separate operational archive from privacy deletion/destruction.
- Build an owner/full-scope workflow that inventories client-linked records, identifies lawful retention, de-identifies/deletes eligible data, and writes a non-sensitive audit record.

### P-PRIV-5 — Calendar minimisation

- Synthetic-test a reduced calendar payload.
- Preserve appointment ID reconciliation and staff-scoped calendars.
- Deploy only after create/update/cancel/reconciliation regression tests pass.

### P-PRIV-6 — Goldie retention classification

- Produce counts/ages by historical table without exporting identifiable rows.
- classify operational record vs required history vs provenance vs migration residue;
- delete only categories approved by the retention policy.

### P-PRIV-7 — Privacy notice / processor / transfer governance

- Complete the provider register and cross-border assessment.
- Publish/serve an appropriate client-facing privacy notice before expanding sensitive-data collection.

## Safety rule

Privacy hardening follows the existing Shiloh self-test-first rule. Use CI, synthetic fixtures, schema-only/read-only production checks and non-identifying aggregates first. Do not expose real-client records, send unnecessary messages, alter genuine appointments, or mass-delete historical data simply to test privacy controls.
