# Shiloh production runtime environment contract

This file records the disposition of production environment keys audited in #654 and the 2026-09-29 automated WhatsApp retirement. It is a runtime/configuration contract, not a place for secret values. The owner reported removing nine retired keys from Render; the replacement deploy `dep-datqh1bncjis739l4370` reached live, but the individual key deletions have not been independently read back.

## Keep — current runtime authority or active integration contract

- `AUDIT_READ_TOKEN` — current audit-read authentication.
- `DATABASE_URL` — production database connection secret.
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_FAST_MODEL` — current OpenAI runtime. The model names override source defaults; review the effective values and cost periodically under `docs/AI_MODEL_REVIEW.md`.
- `SHILOH_HUMAN_WHATSAPP_NUMBER` — direct human Reception link; never an automated sender or account verification channel.
- `MY_SHILOH_SMS_AUTH_ENABLED`, `SMSMESSENGER_ACCOUNT_EMAIL`, `SMSMESSENGER_API_TOKEN` — client enrollment and supervised staff device setup.
- `MY_SHILOH_VAPID_PRIVATE_KEY`, `MY_SHILOH_VAPID_PUBLIC_KEY`, `MY_SHILOH_VAPID_SUBJECT` — app push notifications.
- `SHILOH_CALENDAR_READONLY_UX_ENABLED` — current Workspace Calendar feature control.
- `SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED` — current authenticated Workspace Calendar bridge.
- `WHATSAPP_BOOKING_UPDATE_ENABLED` — still influences booking-update retry selection. Keep until that decision is decoupled from the retired channel.
- `WHATSAPP_RESCHEDULE_APPROVAL_ENABLED` — compatibility fallback for client reschedule requests and Calendar holds, and still referenced by historical WhatsApp/template paths. Keep until the replacement policy is configured to the same observed value and the remaining paths are retired.
- `SHILOH_CLIENT_RESCHEDULE_REQUESTS_ENABLED` — new clinic policy for My Shiloh reschedule requests and Calendar holds. When absent, the existing `WHATSAPP_RESCHEDULE_APPROVAL_ENABLED` value remains authoritative, so this code release does not change production behavior. When explicitly `true` or `false`, it overrides the old value for those clinic paths; any other present value fails closed. Do not set it without confirming the current clinic decision and matching the existing value for cutover.
- `SHILOH_CLIENT_REMINDER_APP_ONLY_ENABLED` — retained app notification policy. Automated WhatsApp sends are blocked in production; an unaccepted app wake does not prove phone delivery and leaves the reminder retryable.
- `SHILOH_CONSULTATION_FORM_APP_ONLY_ENABLED`, `SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED`, `SHILOH_CONSULTATION_FORM_DELIVERY_NOT_BEFORE` — still participate in consultation form scheduling and app delivery. An unaccepted app wake leaves the assignment unsent; automated WhatsApp fallback is blocked in production. Keep until the form scheduler is decoupled from the retired channel.
- `SHILOH_PAYMENT_RECEIPT_APP_ONLY_ENABLED` — retained app receipt policy. The payer needs an active matching My Shiloh profile and accepted push wake; no automated Meta receipt fallback is permitted in production.
- `SHILOH_BOOKING_CONFIRMATION_APP_ONLY_ENABLED` — retained app confirmation policy. A CRM V2 booking with an accepted app wake can close the obligation; otherwise it remains retryable without an automated WhatsApp send.
- Historical `WHATSAPP_*_TEMPLATE` bindings and `WHATSAPP_TEMPLATE_LANGUAGE` still have code references. Keep until each booking, consultation, payment and lifecycle obligation is decoupled or represented in a visible Reception exception queue. Their presence does not authorize automated sending.

## Remove from persistent production configuration — retired or one-shot state

These are not credentials and should not remain as durable production configuration after #654 code is deployed:

- `BIRTHDAY_TEMPLATE_INSPECT_ONCE`
- `BIRTHDAY_TEMPLATE_PROVISIONING_ENABLED`
- `BIRTHDAY_TEMPLATE_SUBMIT_ONCE`
- `CRM_DUMMY_APPOINTMENT_CLEANUP_ON_START`
- `META_BOOKING_CONFIRMATION_V2_PROVISION_ON_START`
- `META_LIFECYCLE_PROVISION_ON_START`
- `META_PROVIDER_RECONNECT_ON_START`
- `META_RESCHEDULE_APPROVAL_TEMPLATES_PROVISION_ON_START`
- `META_PROVIDER_APP_NAME` — used only by the now-removed provider reconnect helper.
- `SHILOH_STAFF_BROWSER_AUTH_WHATSAPP_DELIVERY_ENABLED` — the unreachable challenge adapter has been removed and its historical template gate is permanently closed.
- `META_STAFF_AUTH_TEMPLATE_AUDIT_ON_START`
- `META_STAFF_AUTH_TEMPLATE_PROVISION_ON_START`
- `META_WABA_TEMPLATE_PERMISSION_AUDIT_ON_START`
- `RUN_ADMIN_REPORTS_SELF_TEST_ON_STARTUP`
- `SHILOH_CALENDAR_OCCUPANCY_RESET_RELEASE_SHA`
- `SHILOH_CALENDAR_OCCUPANCY_RESET_RUN_ID`
- `SHILOH_CONTROLLED_RELEASE_MIGRATION` when no specifically authorized controlled migration is active. This is an execution-scoped release input, not standing configuration.
- `SHILOH_EMERGENCY_CHRISTEL_CALENDAR_BOOKING_ENABLED`
- `SHILOH_STAFF_BROWSER_PILOT_ADMIN_IDS`
- `SHILOH_STAFF_BROWSER_PILOT_MODE_ENABLED`
- `WHATSAPP_FOLLOWUP_TEMPLATE` — legacy follow-up contract is retired.
- `WHATSAPP_REMINDER_TEMPLATE` — legacy reminder contract is retired.
- `SHILOH_STAFF_TOTP_AUTH_ENABLED`
- `SHILOH_STAFF_TOTP_PILOT_ADMIN_IDS`
- `SHILOH_STAFF_TOTP_ENCRYPTION_KEYS_JSON`
- `SHILOH_STAFF_TOTP_ACTIVE_KEY_VERSION`
- `WHATSAPP_BOOKING_APPROVAL_REQUEST_TEMPLATE`
- `WHATSAPP_BOOKING_APPROVAL_OUTCOME_TEMPLATE`
- `META_TEMPLATE_INVENTORY_AUDIT_ON_START`

## Retired runtime authority — external secret removal pending

- `ADMIN_API_KEY` — the generic `/admin/*` HTTP authority was retired by #990. Runtime source no longer reads or accepts this key. Removing the residual Render secret is an external credential mutation and requires explicit owner authorization.

## Owner-authorized automated WhatsApp credential removal

The owner explicitly authorized removal of `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` and `VERIFY_TOKEN` after PR #1311. She reported completing the Render cleanup on 2026-09-29; the resulting rebuild reached live. Render's connected tool cannot read individual keys, so their absence remains unverified. Production blocks all automated sends and no longer requires these keys at startup. The Meta webhook verification GET route and an unmounted duplicate controller handler are now removed; POST remains available for historical status receipts. The retired `META_CLIENT_AUTH_TEMPLATE_PROVISION_ON_START`, `META_PROBLEM_REPORT_RESOLVED_PROVISION_ON_START`, `SHILOH_META_SIGNIN_ONLY_ENABLED`, `SHILOH_STAFF_WHATSAPP_PASSKEY_BOOTSTRAP_ENABLED` and `SHILOH_WORKSPACE_CLIENT_NOTIFY_PROVIDER_READY` were also included in the owner's removal list. Keep the human Reception number and SMS, push, OpenAI, payment and database settings.

## Retire code/capability before removing configuration

These keys still have a current code reference or preserve a dormant integration. They are not permission to re-enable that integration.

- `CRM_PROVENANCE_AUDIT_IDS` — current `app.js` still supports an optional startup read-only provenance diagnostic. Remove the startup diagnostic before deleting the key.
- `GOOGLE_CALENDAR_ENABLED`, `GOOGLE_CALENDAR_AUTH_MODE`, `GOOGLE_BOOKING_CALENDAR_ID`, `GOOGLE_ABIGAIL_CALENDAR_ID`, `GOOGLE_CHRISTEL_CALENDAR_ID`, `GOOGLE_MARIETJIE_CALENDAR_ID`, `CHRISTEL_CALENDAR_EMAIL`, `JEAN_PIERRE_CALENDAR_EMAIL` — active scheduling authority is Shiloh-only, but dormant Google provider/config code remains. Keep Google disabled until that provider code is deliberately retired.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` — dormant Google credential material. Code retirement comes first; deletion/rotation of credential material requires explicit owner authorization.

## Secret-removal boundary

The #654 cleanup alone did not authorize deletion or rotation of credential material. The owner later explicitly authorized the four retired WhatsApp credentials above and separately authorized removal of the retired TOTP keyring in #952. Do not delete/rotate `DATABASE_URL`, unrelated API keys, OAuth secrets/tokens or `PEXELS_API_KEY` merely to reduce the visible variable count. A credential can be removed only after its capability is proven unused/retired and the owner explicitly authorizes the exact action.

`PEXELS_API_KEY` has no demonstrated current runtime requirement in this audit, but because it is credential material it remains at this explicit authorization boundary rather than being silently deleted.

## Production startup boundary after #654

Production startup must retain `node scripts/verify-migrations.js` as its first authority gate. The retired #643 Meta reconnect and WABA-template-permission bootstrap modules must not be preloaded by the production start command. Provider mutation remains unavailable unless a future bounded unit deliberately reintroduces an authorized path.
