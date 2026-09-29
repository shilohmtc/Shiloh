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
- `SHILOH_BOOKING_CHANGE_RETRY_ENABLED` — Shiloh-owned retry selection for pending booking updates; only literal `true` scans them. The live legacy decision was `true` and the new policy was set to `true` on unchanged #1320 (`dep-datttvvlk1mc73cv1330` live, startup `policyConfigured=true`, `bookingChangeRetryEnabled=true`). The old retry fallback is removed after this verified cutover.
- `SHILOH_BOOKING_CHANGE_APP_ONLY_ENABLED` — controls My Shiloh booking-change completion for eligible CRM V2 clients. `SHILOH_BOOKING_CHANGE_RETRY_ENABLED` independently selects pending booking changes for retry. The customer-change scheduler no longer provisions Meta templates at startup.
- `SHILOH_CLIENT_RESCHEDULE_REQUESTS_ENABLED` — clinic policy for My Shiloh reschedule requests and Calendar holds. Only the literal `true` enables these paths; missing or any other value fails closed. On 2026-09-29 the existing live decision was observed as enabled in the reschedule schema startup log, then this new Render key was set to `true` on the unchanged #1315 commit. Deploy `dep-dats58bncjis739r29g0` reached live and its startup log again reported `featureEnabled=true`.
- `SHILOH_CLIENT_REMINDER_APP_ONLY_ENABLED` — retained app notification policy. Automated WhatsApp sends are blocked in production; an unaccepted app wake does not prove phone delivery and leaves the reminder retryable.
- `SHILOH_CONSULTATION_FORM_APP_ONLY_ENABLED`, `SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED`, `SHILOH_CONSULTATION_FORM_DELIVERY_NOT_BEFORE` — still participate in consultation form scheduling and app delivery. An unaccepted app wake leaves the assignment unsent; automated WhatsApp fallback is blocked in production. Keep until the form scheduler is decoupled from the retired channel.
- `SHILOH_PAYMENT_RECEIPT_APP_ONLY_ENABLED` — retained app receipt policy. The payer needs an active matching My Shiloh profile and accepted push wake; no automated Meta receipt fallback is permitted in production.
- `SHILOH_BOOKING_CONFIRMATION_APP_ONLY_ENABLED` — retained app confirmation policy. A CRM V2 booking with an accepted app wake can close the obligation; otherwise it remains retryable without an automated WhatsApp send.
- Historical `WHATSAPP_*_TEMPLATE` bindings and `WHATSAPP_TEMPLATE_LANGUAGE` still have code references. Keep until each booking, consultation, payment and lifecycle obligation is decoupled or represented in a visible Reception exception queue. Their presence does not authorize automated sending.
- The customer-care scheduler now reconciles loyalty only; it no longer scans birthday opt-ins or attempts an automated WhatsApp birthday send. Existing opt-in records remain historical preferences. This retirement does not establish an app birthday-delivery path.

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
- `SHILOH_CONTROLLED_RELEASE_MIGRATION` — removed from Render after migration verification reported 178/178 applied and none pending. This remains an execution-scoped release input for a separately authorized future migration, not standing configuration.
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
- `WHATSAPP_RESCHEDULE_APPROVAL_ENABLED` — retired by #1316 after the new Shiloh policy key was confirmed live. Removed from Render; same-commit deploy `dep-datscjou01pc73acdukg` reached live with reschedule `featureEnabled=true` and `/health` 200. Keep the new Shiloh policy key.
- `WHATSAPP_BOOKING_UPDATE_ENABLED` — removed from Render after the verified Shiloh policy cutover. Same-commit deploy `dep-datujc893c1s73c2r04g` reached live with booking retry enabled, the new Shiloh policy configured, and `/health` 200. The subsequent booking-update Meta retirement removed its runtime gate; historical template identity remains read-only.

## Retired runtime authority — external secret removed

- `ADMIN_API_KEY` — the generic `/admin/*` HTTP authority was retired by #990. Runtime source no longer reads or accepts this key. The owner explicitly confirmed removal of the residual Render secret; the refreshed production Environment list shows it absent.

## Other verified Render retirements

- `WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED` — removed from Render after automated Meta sending was retired in production. The payment WhatsApp compatibility entry point always declines delivery, including injected legacy flags. This does not affect My Shiloh payment notices or Ozow callbacks.
- The above three removals were saved together. Same-commit deploy `dep-datv39e7bikc7384dh9g` on `fd9a525431e97db12b84b6a011e4adcfbee776e5` reached live; startup reported booking retry enabled and Shiloh policy configured, 178/178 migrations with none pending, and `/health` HTTP 200. The refreshed Environment list contained 65 keys, down from 68.
- The private consultation form trial's configured expiry was `2026-09-18T19:00:00.000Z`. The owner explicitly confirmed a second Render batch removing `CONSULTATION_FORM_TRIAL_ACCESS_HASH`, `CONSULTATION_FORM_TRIAL_EXPIRES_AT`, `CONSULTATION_FORM_TRIAL_ORIGIN`, `CONSULTATION_FORM_TRIAL_TEMPLATE`, and `SHILOH_CONSULTATION_FORM_TRIAL_ENABLED`. Same-commit deploy `dep-datvh4ad0e5s73dma7v0` reached live with 178/178 migrations, booking retries enabled and `/health` HTTP 200; the refreshed Environment list showed all five absent and 60 keys remaining. Preserve `CONSULTATION_FORM_DATA_KEY`, which decrypts stored submissions. The private test route remains fail-closed until a separately authorized future trial receives fresh temporary settings.
- The earlier 60-key inventory retained 22 historical `WHATSAPP_*_TEMPLATE` bindings or language settings. They are not active automated sending authority. The human Reception number is a separate live contact setting.
- The payment WhatsApp compatibility entry point always declines delivery, even when a caller injects legacy flags or a sender. Booking payment and gift voucher services no longer call it. Accepted My Shiloh deposit and receipt wakes retain their durable delivery record; unaccepted wakes leave the obligation pending. The ten historical Meta payment contracts are retired and cannot be registered or sent.
- The owner confirmed removal of the nine production `WHATSAPP_PAYMENT_*_TEMPLATE` overrides: `BALANCE_DUE`, `DEPOSIT_RECEIVED`, `DEPOSIT_REQUEST`, `NOT_VERIFIED`, `RECEIVED`, `REFUND_UPDATE`, `SPLIT_REQUEST`, `VOUCHER_ISSUED`, and `VOUCHER_REQUEST` (each with the `WHATSAPP_PAYMENT_` prefix and `_TEMPLATE` suffix). The refreshed Render Environment list contained 51 keys, down from 60, with all nine absent. Same-code deploy `dep-dau0gjp7lnhs73evre0g` on `6d185cc59d1c53c54cbf2c1ba9e9109690f37a69` reached live; startup verified 178 migrations with zero pending and `/health` returned HTTP 200 with database `ok`. The human Reception number, My Shiloh SMS and push, staff passkeys, Ozow and consultation data key remain configured.
- The birthday Meta scan was retired in #1322. Its remaining v2 template contract is retired, the maintenance submission command is removed, and code no longer reads `WHATSAPP_BIRTHDAY_TEMPLATE`. Keep the historical template definition as an audit record. Review the exact Render key for deletion after this code deploy is verified; birthday preferences and loyalty rewards remain separate.

## Owner-authorized automated WhatsApp credential removal

The owner explicitly authorized removal of `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` and `VERIFY_TOKEN` after PR #1311. A refreshed Render Environment inventory on 2026-09-29 showed the first, third and fourth keys absent, but `PHONE_NUMBER_ID` still present. With renewed owner confirmation, the remaining identifier was removed. Same-commit deploy `dep-datsfug93c1s73bs2dg0` reached live; the refreshed Environment list showed it absent, startup reported reschedule `featureEnabled=true`, and `/health` returned 200. Production blocks all automated sends and no longer requires these keys at startup. The Meta webhook verification GET route and an unmounted duplicate controller handler are removed; POST remains available for historical status receipts. The retired `META_CLIENT_AUTH_TEMPLATE_PROVISION_ON_START`, `META_PROBLEM_REPORT_RESOLVED_PROVISION_ON_START`, `SHILOH_META_SIGNIN_ONLY_ENABLED`, `SHILOH_STAFF_WHATSAPP_PASSKEY_BOOTSTRAP_ENABLED` and `SHILOH_WORKSPACE_CLIENT_NOTIFY_PROVIDER_READY` were absent in that refreshed inventory. Keep the human Reception number and SMS, push, OpenAI, payment and database settings.

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

The two automated staff finalization WhatsApp schedulers (recurring attendance reminders and historical prompts) are retired after the Meta sending credentials were removed. Their old ledger migrations remain in the migration inventory for checksum authority; no startup timer reads them. Staff finalization remains available through the protected Workspace appointment route.
