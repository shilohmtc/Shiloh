# Shiloh — Data-subject rights lifecycle

## Status

P-PRIV-4 is intentionally being implemented in phases. Its inventory and request-workflow services are preserved and non-destructive. The former shared-key `/admin/privacy/*` HTTP surface was retired by #990 and is not a current operator interface.

## Why preview comes first

A privacy deletion/destruction request is not the same as the existing operational `Delete client` command. The operational command archives a client while preserving CRM and appointment history. A privacy request must instead identify every linked data class, determine what Shiloh remains authorised or required to retain, and erase or de-identify only the eligible categories.

Irreversible deletion is forbidden until the retention decision layer is explicit and tested.

## Preserved preview service

The former endpoint `GET /admin/privacy/clients/:id/preview` is retired and returns the same `410 Gone` response as every legacy `/admin/*` path. Do not use `ADMIN_API_KEY` or `x-admin-key`; they no longer authorize any Shiloh runtime operation.

The preserved internal service produces counts/classifications only. It does not return phone numbers, email addresses, DOB, appointment details, notes, treatment names, profile values, or raw audit metadata.

The preview discovers direct foreign-key references to the canonical `clients` table dynamically. This is deliberate: a future table that links to a client but has not yet been privacy-classified must fail closed as `manual_review_required` rather than being silently omitted or automatically deleted.

The preview also counts known phone-linked operational stores without returning the phone values themselves, including legacy profile/session mappings where those tables exist.

## Classification meanings

- `retain_pending_policy`: history that may have a legal, accounting, operational, dispute, or audit retention purpose; no automated deletion decision has been made.
- `erase_or_deidentify_candidate`: data that may be eligible for erasure or de-identification after identity verification and lawful-retention review.
- `erase_candidate_short_lived`: short-lived operational state expected to be removable when no longer necessary.
- `erase_candidate_operational`: temporary operational intent/state requiring a defined retention decision.
- `temporary_should_expire`: staging state already governed by short automatic retention controls.
- `manual_review_required`: unknown or sensitive data class that must never be auto-deleted or auto-retained without classification.

## Safety invariants

1. Preview is GET-only.
2. Preview performs database reads only.
3. Preview never exposes contact values in its response.
4. Preview never authorises a destructive action; `destructiveActionAllowed` is always `false` in this phase.
5. Unknown future client-linked tables fail closed to manual review.
6. Appointment history causes the proposed action to prefer de-identification after retention review rather than blind record deletion.
7. Existing operational archive behavior remains unchanged.

## Next phase

P-PRIV-4 continues only through a future explicitly authorized, capability-scoped Shiloh Workspace unit. The eventual destructive/de-identification execution path must require explicit confirmation, write a non-sensitive audit record, avoid reintroducing erased personal data into audit metadata, and be covered by synthetic transaction/rollback tests before any production use.
