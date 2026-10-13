# Shiloh OS — Provider / Subprocessor Data-Flow Register

Updated: 2026-08-13; WhatsApp retirement row reconciled 2026-10-13
Status: governance evidence register; **not legal approval and not a destructive-processing authorization**

## Purpose and authority boundary

This register documents externally processed Shiloh data using two deliberately separate evidence classes:

1. **Code-observed / infrastructure-observed fact** — what the deployed Shiloh implementation currently sends, receives, stores, or requests.
2. **Provider / legal fact requiring account-level confirmation** — current public provider documentation may describe controls or contractual terms, but this register does not infer that Shiloh has accepted a particular DPA, enabled a particular retention control, obtained a lawful transfer basis, or completed a POPIA assessment.

This file is subordinate to `docs/SHILOH-OS-MASTER-STATUS.md`. It does not establish a retention period, lawful basis, Section 72 transfer mechanism, prior-authorisation conclusion, consent, or owner approval. Where evidence is missing, the state is `REVIEW_REQUIRED` rather than guessed.

## POPIA cross-border control gate

Shiloh operates in South Africa. POPIA regulates transfers of personal information outside the Republic. A foreign transfer must therefore be assessed against the applicable Section 72 route and any other applicable POPIA obligations before this register may be promoted from technical mapping to an approved legal/governance record.

No provider row below is marked `LEGALLY_APPROVED`. Public vendor terms, certifications, security claims, or availability of a DPA are **not** treated as proof that Shiloh's own transfer, notice, contract, purpose, retention, or account configuration is compliant.

The existing health-data red line remains controlling: medical history, medications, allergies, pregnancy/contraindication information, treatment notes, or other health/special personal information must not be moved into generic AI profile/preferences, ordinary conversation memory, or general-purpose provider context without a separately designed protected domain and explicit legal/governance review.

## Provider register

| Provider / system | Shiloh purpose | Code/infrastructure-observed data boundary | Current technical controls / minimization evidence | External/provider facts reviewed | Unresolved Shiloh decision / evidence | State |
|---|---|---|---|---|---|---|
| **Meta / WhatsApp Cloud API** | Historical delivery-status evidence; direct human Reception contact | Ordinary incoming client/staff messages are acknowledged without automated conversation or booking processing. The mounted callback accepts delivery statuses and can update historical delivery/retry evidence. Reception links open a direct human WhatsApp conversation outside the app assistant. | Automated outbound messaging is retired; compatibility send functions fail closed. The old bot controller and isolated choice/provisioning entry points are removed in the current cleanup. Status parsing/logging sanitizes provider evidence; this remains a write-capable callback, not a read-only archive. Shared message definitions remain intact. | Meta's current public WhatsApp/Business terms provide a contractual/data-processing framework and the Tech Provider terms reference Cloud API hosting terms and data-protection obligations. Public terms alone do not prove which exact terms/account agreements Shiloh has accepted. | Confirm account-specific terms, historical retention and transfer basis; review the retained callback authentication/retirement policy separately. This source cleanup does not verify current provider credential absence, erase historical records or change the human Reception channel. | `REVIEW_REQUIRED` |
| **Render** | Hosts the Node application and production Postgres datastore | Authoritative account inspection confirms both the production web service and the bound primary Postgres `shiloh-memory` / `shiloh_memory` are in **Oregon, USA**. The database is `available` on paid plan `basic_256mb` with 1 GB storage. The former Free-tier expiry was removed by an explicitly owner-authorized in-place upgrade; G1 issue #166 is closed completed. | Web service is unsuspended with one instance. Database storage autoscaling is disabled, High Availability is disabled, and no read replicas are configured. Post-upgrade active connections positively evidenced application/database continuity. No claim is made that HA, a restore test, PITR account configuration, or all platform/system-log retention has been verified. | Render publishes a DPA, an authorized-subprocessor process/list, security/compliance material, and region documentation. Render currently documents Oregon as a US deployment region. | Confirm which Render DPA/terms bind Shiloh; review current authorized subprocessors and notification process; determine/document the applicable POPIA Section 72 transfer basis; verify paid-database recovery/PITR and backup retention from account state; define deletion/backup handling and a tested restore procedure. | `REVIEW_REQUIRED` |
| **OpenAI API** | General conversational response generation and embeddings/AI-supported functions where invoked | `src/services/ai.js` sends the current user message as `input` plus Shiloh-generated `instructions` built from the allowlisted client profile and authoritative knowledge. The current Responses request explicitly sets `store: true` and may send `previous_response_id`. Local response-ID reuse is separately bounded by Shiloh's P-PRIV-2 controls. | P-PRIV-1 excludes opaque/unclassified profile attributes from general AI context. P-PRIV-2 bounds local response-ID reuse. Usage logs record provider/model/response ID/token counts rather than prompt text in `ai.js`. Health/special-personal-information use in generic AI context is prohibited by project policy. | OpenAI's current official API data-controls documentation states API data is not used for model training by default unless the customer opts in. It also documents default abuse-monitoring retention and Responses API application-state behavior; with `store: true`, response state is retained by the provider under the documented Responses retention rules. Zero Data Retention/Modified Abuse Monitoring are separate account-level controls subject to eligibility/configuration. | Verify Shiloh's actual OpenAI organization/project data-control setting; determine whether conversation continuity can safely move toward `store:false` or another approved configuration without degrading required functionality; confirm the binding DPA/services agreement and transfer basis; document deletion/data-subject handling for provider-side state. | `REVIEW_REQUIRED` |
| **Google Calendar API / Google Workspace** | Availability checking and human booking diary/mirror | Shiloh currently requests the broad `https://www.googleapis.com/auth/calendar` scope. Booking events visibly place service/treatment, client and practitioner in the summary; the description repeats CRM appointment ID, client, service, practitioner, location and source; private extended properties separately store appointment/source/staff/service identifiers. Availability reads list event details to determine conflicts. | Extended properties used for machine synchronization are private to the relevant event/calendar copy. Deterministic appointment IDs and CRM authority reduce reliance on free-text matching. Current design remains fail-closed around calendar uncertainty. | Google documents narrower Calendar scopes and recommends requesting the most narrowly focused scope possible. Google also documents event visibility controls and private extended properties. | Establish authoritative staff diary requirements: whether client name, treatment/service, practitioner and location must be human-visible and on which calendars. Then minimize duplicated visible fields and assess whether the current broad Calendar scope can be narrowed without breaking availability/write/reconciliation behavior. Confirm Workspace account sharing/ACLs, retention/deletion rules, binding contractual/data-processing terms and transfer basis. | `REVIEW_REQUIRED` |

## Code evidence map

### Meta / WhatsApp

- `src/routes/webhook.js`
  - mounts the delivery-status handler and an HTTP 200 acknowledgement;
  - ordinary inbound messages invoke no bot conversation or booking action.
- `src/controllers/whatsappStatusWebhookController.js` and `src/services/whatsappStatusEvidence.js`
  - sanitize and persist historical delivery statuses;
  - retain the existing evidence/retry write boundary, with no record purge in this cleanup.
- `src/services/whatsapp.js`
  - retains compatibility send functions that reject automated outbound sending.
- `src/services/publicWhatsApp.js`
  - keeps direct human Reception contact separate from retired automation.

### OpenAI

- `src/services/ai.js`
  - sends `input: message` and generated instructions;
  - explicitly uses `store: true`;
  - may continue provider state with `previous_response_id`;
  - logs usage metadata without logging prompt text in this service.
- P-PRIV-1/P-PRIV-2 controls remain documented in the Master ledger and their regression history.

### Google Calendar

- `src/services/googleBookingCalendar.js`
  - currently uses the broad Calendar scope;
  - duplicates booking details across visible summary, visible description and private extended properties;
  - mirrors bookings to shared/practitioner calendars where configured;
  - reads events for conflict detection.

### Render

- Authoritative Render account inspection on 2026-08-13 confirms production web service `shiloh-whatsapp-bot` is in Oregon, USA, on branch `main`, unsuspended, with one instance.
- The bound production Postgres `shiloh-memory` / `shiloh_memory` is also positively confirmed in Oregon, USA. It is a primary, status `available`, plan `basic_256mb`, 1 GB storage, storage autoscaling disabled, High Availability disabled, and no read replicas.
- G1 continuity was resolved by the owner-authorized in-place upgrade of this existing database from Free; issue #166 is closed. Positive post-upgrade active connections established continuity.
- This account evidence closes the prior uncertainty about the database region and Free-tier expiry. It does **not** establish a tested restore procedure, HA, binding DPA acceptance, POPIA transfer authority, or verified PITR/backup retention configuration.

## External source register reviewed 2026-08-13

Public primary/authoritative materials reviewed for this technical governance snapshot:

- South African Government — Protection of Personal Information Act 4 of 2013.
- Information Regulator (South Africa) — POPIA guidance / prior-authorisation materials.
- OpenAI — API Data Controls in the OpenAI Platform; current Data Processing Addendum / business-services legal materials.
- Google for Developers — Calendar API authorization scopes, event sharing/visibility, extended properties, and API user-data policy.
- Render — Regions documentation and Data Processing Addendum.
- Meta — current public Meta/WhatsApp business and technology-provider legal materials relevant to WhatsApp Business Solution / Cloud API processing.

These public materials are evidence that provider controls/frameworks exist. They are **not** evidence that Shiloh has completed account-specific configuration or contractual/legal approval.

## Required closure evidence

C1.10 provider/cross-border governance must remain open until, at minimum:

1. Shiloh's responsible owner/legal authority records the applicable lawful processing and cross-border transfer basis for each personal-data flow.
2. Account-level provider/DPA/terms status is evidenced rather than inferred from public webpages.
3. Provider retention/deletion and backup handling relevant to Shiloh is documented, including OpenAI Responses state and Render datastore/backups.
4. Google Calendar human-diary requirements and ACL/access scope are authoritatively established, then the event payload and OAuth scope are minimized to the least functionality-compatible level.
5. The privacy notice/data-subject handling process accurately describes material provider categories and international processing.
6. Any future special-personal-information processing is separately designed and assessed before use.

Until those gates are met, no real erasure/de-identification executor may be enabled merely because this data-flow map exists.
