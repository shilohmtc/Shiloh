# Shiloh Message Contracts

Status: **Canonical messaging architecture**

Owner: **Shiloh messaging**

This document defines the authority boundary for Shiloh operational messages. It complements `docs/META-TEMPLATE-READINESS-MATRIX.md`; where historical template-count prose conflicts with current code, the current Shiloh message-contract registry is authoritative.

## Governing flow

Shiloh owns the business message. Meta is a replaceable WhatsApp transport/provider binding.

**Shiloh event → Shiloh message contract → Meta adapter registration payload → Meta approval/readback → Shiloh provider binding → runtime send.**

The provider must never become the only durable definition of a Shiloh operational message.

## Canonical code authority

- `src/services/shilohMessageContracts.js` — provider-neutral Shiloh message identities, lifecycle, semantic content and deterministic spec identity.
- `src/services/metaTemplateAdapter.js` — Meta-specific names/environment bindings, deterministic registration payloads and provider readback/binding resolution.
- `src/services/metaTemplateContracts.js` — read-only Meta inventory, feature delivery gates and fail-closed runtime send authorization. It preserves the legacy `assertTemplateSendAllowed()` compatibility path while routing authority through Shiloh contract IDs.
- Existing `*TemplateProvisioning.js` and template-definition modules remain the source of reviewed message bodies/components while the registry consolidates those definitions into one canonical lifecycle inventory. Provider writes remain explicit provisioning operations, never normal startup behavior.

## Current inventory

Current code records **19 Shiloh message identities**:

- **16 current/sendable contracts**
- **3 retired/non-sendable contracts**

Current/sendable:

1. `booking_update`
2. `staff_auth_otp`
3. `staff_finalization_actions`
4. `appointment_followup_v2`
5. `booking_approval_outcome`
6. `booking_declined`
7. `booking_approval_request`
8. `reschedule_approval_request`
9. `reschedule_declined`
10. `cancellation_confirmation`
11. `reschedule_confirmation`
12. `appointment_reminder_actions`
13. `booking_confirmation`
14. `booking_confirmation_v2`
15. `staff_finalization`
16. `birthday_v2`

Retired/do not recreate:

- `birthday_v1`
- `appointment_followup_legacy`
- `appointment_reminder_legacy`

The older readiness document contains historical counts from earlier provider audits. Those counts are evidence of prior provider state, not the current canonical contract inventory.

## Provider-neutral contract identity

A Shiloh message contract contains:

- stable Shiloh contract ID;
- lifecycle (`current` or `retired`);
- sendability;
- language;
- category;
- semantic message components;
- message-send TTL where the business contract requires one.

It deliberately does **not** contain:

- WABA IDs;
- Meta template IDs;
- Meta account ownership;
- Graph credentials/tokens;
- environment-variable names;
- provider approval status.

The semantic contract is hashed deterministically with SHA-256. Registration examples and provider-managed/readback metadata do not change the Shiloh spec identity. Object-key ordering does not affect the hash.

For Meta authentication templates, provider readback may represent the copy-code OTP button as a provider-managed URL. Shiloh normalizes the provider URL representation and the registration `OTP/COPY_CODE` representation to the same semantic contract before comparison.

## Meta adapter

The Meta adapter owns the provider-specific mapping from a Shiloh contract ID to:

- Meta template name;
- runtime environment binding where applicable;
- deterministic Graph `message_templates` registration payload.

Building a registration payload is a pure operation. It does not call Graph and does not mutate Meta.

Retired contracts cannot produce a registration payload. They remain recorded only so old provider assets and historical evidence can be classified correctly.

## Approval/readback and provider binding

A Meta provider template becomes a valid Shiloh binding only when all of the following are true:

1. the Shiloh contract is current and sendable;
2. the expected Meta template name exists;
3. exactly one provider variant exists for the required language;
4. provider status is `APPROVED`;
5. the provider semantic spec hash exactly matches the Shiloh contract spec hash.

The binding fails closed when the provider template is:

- missing;
- pending;
- rejected;
- wrong-language;
- duplicated for the exact name/language;
- semantically drifted;
- retired.

Provider template IDs may exist inside the adapter's binding result for provider reconciliation, but read-only public/runtime inventory sanitizes that provider ID. The provider ID is not Shiloh's message identity.

## Runtime send authority

Runtime code should resolve sends by Shiloh contract ID through `assertMessageContractSendAllowed(contractId, language)`.

A send is authorized only when:

- the Shiloh contract is current/sendable;
- language matches the contract;
- configured Meta name matches the contract's adapter binding;
- any existing feature delivery gate is enabled;
- current provider readback produces an approved exact binding.

Existing delivery gates remain intact, including booking-update, reschedule-approval and staff-auth WhatsApp delivery gates.

`assertTemplateSendAllowed(templateName, language)` remains as a compatibility adapter for current call sites. It resolves the Meta template name back to the Shiloh contract ID and then uses the same canonical runtime gate.

## Deleted/replaced WABA recovery model

Deleting a WABA must not delete Shiloh's messaging authority.

After an owner-authorized provider rebuild:

1. Shiloh confirms the intended WABA and phone-number authority.
2. The Meta adapter generates registration payloads for only current/sendable Shiloh contracts.
3. An explicit provider provisioning action submits those payloads to Meta.
4. Meta approves/rejects provider assets on its normal provider lifecycle.
5. Shiloh performs read-only template discovery.
6. Exact approved provider variants are bound back to Shiloh contract IDs/spec hashes.
7. Required runtime environment bindings are configured.
8. Runtime template sends are proved end-to-end through the canonical contract resolver.

The three retired identities are not recreated merely because an old WABA was deleted.

## Authorization boundary

Repository contract/adapter code, deterministic payload generation and read-only provider discovery are technical Shiloh work.

The following remain explicit external-provider/security mutations and are not performed merely because the contract registry exists:

- create/recover/delete a WABA;
- register, move or delete a WhatsApp phone number;
- submit/create/delete live Meta templates;
- transfer provider ownership/control;
- create, rotate, revoke or disclose Meta credentials/secrets.

These actions require the authorization applicable under `docs/SHILOH_OPERATING_RULES.md`.

## Design rule

**Shiloh owns meaning and durable contract identity. Meta owns only the WhatsApp-specific provider asset and approval state.**

A provider replacement should therefore be a binding/provisioning exercise, not a reconstruction of Shiloh business messaging from provider memory.
