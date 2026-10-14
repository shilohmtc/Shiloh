# Shiloh OS — Production Handoff — Next Chat — 11 Aug 2026


> Historical record. As of 14 October 2026, automated WhatsApp routing is retired and the dormant language/onboarding/booking-gate modules mentioned below are removed. Retained canonical identity helpers still support My Shiloh and current booking flows. Use [SHILOH_PLATFORM_HANDBOOK.md](SHILOH_PLATFORM_HANDBOOK.md) for current runtime boundaries.
> **Project/chat identity:** Shiloh OS
>
> Every continuation of this production project should identify itself as **Shiloh OS**. When starting a fresh ChatGPT conversation, use **Shiloh OS** as the conversation title when the interface permits manual naming. The handoff cannot programmatically rename the ChatGPT sidebar conversation, so this naming convention is the authoritative project standard.

This is the authoritative concise next-chat entry point. GitHub `main`, Render production, Shiloh CRM and Google Calendar override older handoff wording.

## Current state

- ✅ P0 closed / complete.
- ✅ P1 closed / complete; Goldie is retired from Shiloh's active booking stack and remains archival only. Goldie's Google third-party booking link removal has been requested and may take up to 5 days to disappear publicly.
- ✅ P2 functionally complete; role-scoped WhatsApp admin access and dedicated Marietjie/Abigail calendars are live.
- 🟡 P3 core experience complete, with the prioritized customer-care/reporting items below genuinely unfinished.
- ⬜ P4 not started.

## 11 Aug final GitHub / Render audit

- GitHub `main` and Render production are authoritative; verify their current state before acting rather than relying on an older recorded SHA.
- GitHub CI uses Node `24.14.1`, `npm ci`, and the non-mutating `npm test` regression suite.
- Render service `shiloh-whatsapp-bot` is on `main`, auto-deploy is enabled, health path is `/health`, and production health checks are expected to return HTTP 200 before advancing changes.
- Audit finding fixed: `englishLanguageGuard` used `max_output_tokens:8`, which current OpenAI Responses rejects because the minimum is 16. It was corrected to 16 and regression-locked.
- Audit finding fixed: the temporary `BIRTHDAY_TEMPLATE_INSPECT_ONCE` startup hook/import was removed and regression-locked so normal startup contains only long-running production schedulers.
- Historical startup/test errors from superseded deploys/one-time rollout work must not be reopened unless they recur on the current clean production deploy.

## Recently completed and production-verified

- ✅ Christel personal-account Google Calendar permission test.
- ✅ Staff-scoped CRM authorization and role-specific WhatsApp admin menus.
- ✅ Marietjie tenant-practitioner permissions + `Shiloh — Marietjie` calendar.
- ✅ Abigail employee-practitioner permissions + `Shiloh — Abigail` calendar.
- ✅ Existing future appointments populated into staff calendars.
- ✅ Premium customer greeting and walk-in QR registration.
- ✅ Booking confirmation/calendar-add, client cancellation/rescheduling and reminder/customer-care infrastructure.
- ✅ Birthday/loyalty foundations.
- ✅ Catalogue cleanup and legacy Goldie naming cleanup.
- ✅ Google Calendar presentation cleanup.
- ✅ Final Goldie reconciliation and Shiloh-side public booking shutdown/cutover.
- ✅ Public CRM-backed services catalogue, professional descriptions, WhatsApp deep links and Shiloh-hosted service imagery.
- ✅ Versioned Booking Policy & explicit WhatsApp consent gate with safe synthetic production verification.
- ✅ Staff-scoped WhatsApp `Today` operational reporting. Christel/Jean-Pierre receive business-wide summaries; Marietjie/Abigail receive practitioner-self summaries only. Production read-only self-test proved zero cross-staff/cross-service leakage and no practitioner revenue exposure.
- ✅ Public Shiloh booking landing page `/book`, linked to the official WhatsApp assistant with a prefilled booking intent and no hidden auto-redirect. Public branding is `Shiloh Massage Therapy and Aesthetic Clinic`; headline is `Your appointment starts with Shiloh, your AI assistant.`
- 🟡 Google Business Profile: Shiloh `/book` has been set as the PREFERRED booking link. Goldie provider-link removal was already requested; wait for provider/Google propagation rather than repeatedly editing the profile.
- 🟡 Booking-page photography enhancement is optional polish and waits for original clinic image files; do not use screenshots containing obsolete Goldie copy.
- ✅ Safe self-test-first engineering workflow is authoritative.

## P3 birthday template exact state

- Legacy template `shiloh_birthday_wish_v1` exists at Meta but contains retired brand copy (`Shiloh Medical & Training Centre`) and must never be enabled even if Meta approves it.
- Brand-correct template submitted to Meta: `shiloh_birthday_wish_v2`.
- Current public brand in v2: `Shiloh Massage Therapy and Aesthetic Clinic`.
- WABA ID: `4002592316709920`.
- v2 submission succeeded on 11 Aug 2026; provider state immediately after submission: `PENDING` / `MARKETING`.
- Production remains intentionally fail-closed: `WHATSAPP_BIRTHDAY_TEMPLATE` must remain unset until v2 approval is positively verified.
- Customer-care code already enforces explicit birthday opt-in and once-per-client/per-birthday-year delivery tracking.
- A scheduled approval watch exists for `shiloh_birthday_wish_v2`; do not repeatedly mutate or resubmit while Meta review is pending.
- Once v2 is positively verified `APPROVED`, configure `WHATSAPP_BIRTHDAY_TEMPLATE=shiloh_birthday_wish_v2`, deploy safely, and verify opt-in/idempotency without unintended real-client messages.

## Safe self-test-first rule

For every new feature or production change, first attempt automated/CI tests, then synthetic/isolated/dry-run/read-only production verification. Use narrowly guarded temporary test hooks only when genuinely needed; remove them afterward and verify the clean final state. Do not send unnecessary real-client messages, alter genuine bookings/calendar events, impersonate staff, weaken authorization or expose cross-staff data merely to test. Ask Christel/Jean-Pierre to intervene only when a real external/personal-account/human-approval step genuinely cannot be performed safely through available tooling.

## Recommended next sequence / project checklist

Use this checklist as the ordered roadmap. Before starting an item, verify its current authoritative state because work may have been completed since this handoff was written. Start with the highest-priority genuinely unfinished **actionable** item, not merely the first item listed.

1. 🟡 **P3 — WhatsApp birthday template approval/configuration.** v2 has been submitted with the current brand and is externally blocked on Meta approval. Keep outbound fail-closed while pending/rejected. Once `shiloh_birthday_wish_v2` is positively verified `APPROVED`, configure it in Render and safely verify opt-in/idempotency without unintended client messages.
2. 🟡 **P3 — Treatment-aware aftercare + rebooking.** Build service/category-aware aftercare and intelligent rebooking guidance on top of the existing customer-care scheduler, with fail-closed mapping for unknown services. This is likely the highest customer-experience gain while birthday approval is externally blocked.
3. 🟡 **P3 — Loyalty redemption automation.** Convert the existing loyalty foundation into a controlled redemption lifecycle with atomic state transitions, audit history, authorization, idempotency and failure recovery. Do not implement redemption as simply subtracting a reward balance.
4. 🟡 **P3 — Reporting expansion.** Reuse the verified authorization/scope engine in this order: **Tomorrow → This Week → Services/Trends → Availability → optional scheduled weekly owner summary.** Never introduce a separate authorization path.
5. 🟡 **P3 optional — Dedicated reminder-confirmation state.** Add explicit reminder confirmation/status tracking only if operationally useful after the higher-value P3 items above.
6. ⬜ **P4 — Ozow/payment/voucher architecture.** Treat this as a deliberate architecture phase: discovery/design first, then payment ledger + webhook signature/idempotency, then voucher lifecycle. Keep payment webhook truth separate from appointment truth and never mark paid from a browser redirect alone.

## Execution rule

Work through the checklist one genuinely unfinished priority at a time.

After completing or safely advancing an item:

1. Verify the result against the authoritative production systems.
2. Update tests and documentation/handoff state where appropriate.
3. State clearly whether the item is **complete, externally blocked, partially complete, or still unfinished**.
4. Move automatically to the next genuinely actionable priority when it is safe to do so.
5. Do not enable production behavior merely because implementation is complete; verify all required external approvals/configuration first.
6. Do not redo an item that authoritative evidence shows is already complete.

When an item is externally blocked but safely prepared — for example, waiting for Meta approval — preserve the safe production state and continue with the next roadmap item if doing so cannot interfere with the blocked work.

## Do not reopen unless a regression is found

- P0 stabilization work.
- P1 Goldie reconciliation/cutover work.
- P2 staff-scope/calendar rollout.
- Existing service catalogue/imagery work.
- Booking Policy consent gate.
- Staff-scoped Today reporting.
- Completed Google Calendar rollout/presentation cleanup.

## Start here in the next chat

# Shiloh OS

**Continue the Shiloh OS production project from `docs/HANDOFF-NEXT-CHAT-2026-08-11.md`.**

**Conversation naming convention:** this project is **Shiloh OS**. Use **Shiloh OS** as the chat/conversation title when the ChatGPT interface permits it. If the title cannot be controlled programmatically, still identify the project as Shiloh OS throughout the continuation.

Treat **GitHub `main`, Render production, Shiloh CRM and Google Calendar as authoritative**.

Do not redo completed work.

Apply the **safe self-test-first engineering rule automatically**: test safely yourself first and only ask for my intervention when genuinely necessary.

Start with the **highest-priority genuinely unfinished actionable item**. If an earlier item is safely prepared but externally blocked, preserve its fail-closed state and continue to the next actionable priority.

### Recommended next sequence

- 🟡 **Birthday template approval/configuration** — `shiloh_birthday_wish_v2` is submitted with the current brand; verify Meta status before enabling. Keep outbound disabled until positively `APPROVED`.
- 🟡 **Treatment-aware aftercare + rebooking** — highest actionable customer-experience priority while birthday approval is externally blocked.
- 🟡 **Loyalty redemption automation** — atomic redemption/audit/idempotency/authorization, not simple reward subtraction.
- 🟡 **Reporting expansion** — Tomorrow → This Week → Services/Trends → Availability → optional weekly owner report, all through the existing verified authorization/scope engine.
- 🟡 **Optional reminder-confirmation state** — useful, but below the four priorities above.
- ⬜ **P4 Ozow/payment/voucher architecture** — deliberate architecture phase; keep payment webhook truth and booking truth separate.
