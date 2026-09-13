# Shiloh production runtime environment contract

This file records the disposition of production environment keys audited in #654. It is a runtime/configuration contract, not a place for secret values.

## Keep — current runtime authority or active integration contract

- `ADMIN_API_KEY` — current admin API authentication.
- `AUDIT_READ_TOKEN` — current audit-read authentication.
- `DATABASE_URL` — production database connection secret.
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_FAST_MODEL` — current OpenAI runtime.
- `PHONE_NUMBER_ID`, `VERIFY_TOKEN`, `WHATSAPP_TOKEN` — current WhatsApp transport/webhook configuration; provider readiness may remain fail-closed but runtime still depends on the adapter.
- `WHATSAPP_BUSINESS_ACCOUNT_ID` — current Meta/WABA discovery/binding input.
- `WHATSAPP_TEMPLATE_LANGUAGE` — current template delivery language setting.
- `SHILOH_CALENDAR_READONLY_UX_ENABLED` — current Workspace Calendar feature control.
- `SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED` — current authenticated Workspace Calendar bridge.
- `WHATSAPP_BOOKING_UPDATE_ENABLED`, `WHATSAPP_RESCHEDULE_APPROVAL_ENABLED` — current fail-closed delivery gates.
- Current Shiloh message-contract bindings: `WHATSAPP_BIRTHDAY_TEMPLATE`, `WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE`, `WHATSAPP_BOOKING_DECLINED_TEMPLATE`, `WHATSAPP_BOOKING_UPDATE_TEMPLATE`, `WHATSAPP_CANCELLATION_CONFIRMATION_TEMPLATE`, `WHATSAPP_FOLLOWUP_ACTIONS_TEMPLATE`, `WHATSAPP_REMINDER_ACTIONS_TEMPLATE`, `WHATSAPP_RESCHEDULE_APPROVAL_REQUEST_TEMPLATE`, `WHATSAPP_RESCHEDULE_CONFIRMATION_TEMPLATE`, `WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE`.

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

## Retire code/capability before removing configuration

These keys still have a current code reference or preserve a dormant integration. They are not permission to re-enable that integration.

- `CRM_PROVENANCE_AUDIT_IDS` — current `app.js` still supports an optional startup read-only provenance diagnostic. Remove the startup diagnostic before deleting the key.
- `SHILOH_STAFF_BROWSER_AUTH_WHATSAPP_DELIVERY_ENABLED` — current Meta contract guard still references it even though browser WhatsApp OTP was retired by #607. Retire the obsolete contract/gate path before deleting it.
- `GOOGLE_CALENDAR_ENABLED`, `GOOGLE_CALENDAR_AUTH_MODE`, `GOOGLE_BOOKING_CALENDAR_ID`, `GOOGLE_ABIGAIL_CALENDAR_ID`, `GOOGLE_CHRISTEL_CALENDAR_ID`, `GOOGLE_MARIETJIE_CALENDAR_ID`, `CHRISTEL_CALENDAR_EMAIL`, `JEAN_PIERRE_CALENDAR_EMAIL` — active scheduling authority is Shiloh-only, but dormant Google provider/config code remains. Keep Google disabled until that provider code is deliberately retired.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` — dormant Google credential material. Code retirement comes first; deletion/rotation of credential material requires explicit owner authorization.

## Secret-removal boundary

The #654 cleanup does not authorize deletion or rotation of credential material. In particular, do not delete/rotate `DATABASE_URL`, API keys, OAuth secrets/tokens, `WHATSAPP_TOKEN`, or `PEXELS_API_KEY` merely to reduce the visible variable count. A credential can be removed only after its capability is proven unused/retired and the owner explicitly authorizes the exact credential action. The owner separately authorized removal of the retired TOTP keyring in #952 after code cutover.

`PEXELS_API_KEY` has no demonstrated current runtime requirement in this audit, but because it is credential material it remains at this explicit authorization boundary rather than being silently deleted.

## Production startup boundary after #654

Production startup must retain `node scripts/verify-migrations.js` as its first authority gate. The retired #643 Meta reconnect and WABA-template-permission bootstrap modules must not be preloaded by the production start command. Provider mutation remains unavailable unless a future bounded unit deliberately reintroduces an authorized path.
