# Consultation form appointment delivery v1

This slice connects the existing secure client consultation form to canonical booked appointments without changing the form or submission encryption model.

## Authority and safety

- Required forms are discovered only through `consultation_form_service_mappings`; runtime does not guess treatment names.
- Only future `scheduled` or `confirmed` appointments with exactly one canonical legacy or CRM V2 client can receive an assignment.
- Assignment creation is idempotent on `(appointment_id, template_version_id)`.
- The secure client form feature and `CONSULTATION_FORM_DATA_KEY` must already be available.
- WhatsApp delivery additionally requires `SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED=true`.
- The exact Meta template must be approved and match Shiloh's canonical message contract before a send is allowed.
- Recipient resolution reuses the existing verified booking-confirmation identity boundary. Legacy clients require unique exact phone ownership and an authoritative client-facing name.
- A fresh high-entropy form token is issued only when an actual delivery attempt is ready. The database keeps only its SHA-256 hash.
- WhatsApp receives only client name, treatment name, appointment date and the opaque URL token. Health answers, signatures and practitioner notes are never included.
- An assignment becomes `sent` only after Meta accepts the message.
- A provider outcome that may be uncertain is audited as `consultation_form.delivery_uncertain`; automatic scans then stop retrying that assignment until it is reviewed.

## Rollout

The scheduler itself is safe to deploy while dark. Keep `SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED=false` until the consultation form Meta template is `APPROVED` and exact. No database migration is introduced by this slice.

Reminder delivery is intentionally not enabled here. The reminder template is registered in the canonical contract registry, but a reminder needs an explicit token-rotation policy because plaintext bearer tokens are never persisted.
