# Workspace and My Shiloh audit — 3 October 2026

This audit follows JP’s request for a broader bug check after the report, profile,
booking-list and Workspace sign-out fixes. It provides evidence for the checked
paths, not a guarantee that the platform has no defects. Exact PR, CI, merge and
production deployment evidence belongs to the existing roadmap issue #611.

## Confirmed defects and fixes

| Finding | Reproduction | Result |
| --- | --- | --- |
| Workspace access preset was lost on submit | The production browser handler disabled the hidden input before constructing `FormData`; the request contained `preset: null`. The new browser regression failed against the original handler. | Capture the preset before disabling controls. Phone and desktop checks cover the request, CSRF header, revision, refused-save recovery and successful retry. Server permission, preset and stale-revision checks remain unchanged. |
| My Shiloh update deleted other applications’ caches | Execute the production worker activation handler with current/old My Shiloh caches plus Workspace and another application's caches. The original handler deleted both other applications’ caches. | Delete only obsolete caches with the `my-shiloh-` prefix. Preserve current caches and unrelated applications. |
| A client notification could navigate Workspace | Execute the production notification-click handler with Workspace first in the same-origin window list. It navigated Workspace even with My Shiloh open. | Reuse only a same-origin My Shiloh window; otherwise open the notification target separately. Tests cover both existing-client and Workspace-only cases. |

CI also reproduced a verification-tooling defect: Storybook and Vite copied the
same public directories concurrently, failing with `EEXIST` in two independent
jobs. Storybook now owns the static copy; Vite’s separate public directory is
disabled. The rebuilt catalogue and required app assets were checked locally.

The handbook’s older report workflow description is also aligned with the already
accepted one-click resolution, optional note and automatic acknowledgement. No
booking, payment, session duration, access policy or notification content change
is introduced by these fixes.

## Journey and boundary coverage

| Area | Evidence checked | Limits |
| --- | --- | --- |
| Entry, sessions and devices | Client SMS/passkey/recovery regressions; staff enrollment and session-boundary tests; guest/direct-navigation guards; shared sign-out revocation browser proof; installed-app entry and recovery stories. | Browser tests use synthetic identities and credentials. They do not exercise a physical fingerprint/face prompt or send a live SMS. |
| Client profile and welcome voucher | Canonical input validation; session-owned identity, revision and transaction tests; actual browser profile serialization, refused-save input retention; voucher eligibility, redemption and wallet tests. | No production client profile was changed for testing. |
| Single and multiple bookings | Availability, conflicts, staff mappings, approval authority, repeated submissions and rollback tests; source review of canonical locks and final conflict checks; browser native booking, cart review/retry and both same-day bookings. | Synthetic DB/provider fixtures do not establish a new production booking. |
| Booking changes and outcomes | Cancellation/reschedule/proposal and approval regressions; pending-change preservation; Calendar/Dashboard phone and desktop outcome and recovery checks. | No live appointment was cancelled, rescheduled or finalized. |
| Payments | Verified-provider evidence and monotonic payment-state tests; cancellation invalidation and late-payment safety; combined-deposit approval tests; payment/terms/status and retry stories. | No live charge, refund or new provider callback was initiated. |
| Reports and client updates | Reporter-scoped reads; JP-only status authority; atomic acknowledgement/resolution updates; duplicate-resolution tests; inbox, optional notes and archive/restore browser checks. | Application notification records and a push wake do not prove device display or client reading. |
| Workspace operations | Existing Calendar, staff, access, clients, services/categories, clinic-hours, vouchers, Rewards and Clinic reports regressions and browser stories; server-side capability and scope tests. | Automated role fixtures cover defined boundaries, not every combination of live accounts and devices. |
| Installed apps and offline behavior | Worker cache isolation and notification-window regressions; network-only private endpoints; Workspace offline refresh/update recovery; installation, icon and iPad privacy stories. | Physical iOS/Samsung installation, OS suspension and offline/back-button privacy remain device acceptance. |
| Layout and accessibility | Storybook build; configured Chromium phone/desktop/iPad UX suite; relevant WCAG axe checks and screenshots. | Chromium emulation is not Safari or an Android WebView. |
| Release and operations | Full repository tests, lint and configuration formatting; all applicable exact-head CI gates; read-only live health, private-route protection, deployed source and migration checks. | Unused-production-code analysis is an existing advisory maintenance report, not a passed blocking gate. |

## Initial local evidence

- Baseline: 2,689 of 2,690 Node tests passed. The sole local failure was the
  existing Chrome CLI navigation proof unable to find its executable; that check
  must pass in the exact-head CI environment before release.
- After the fixes: 2,691 of 2,692 Node tests passed locally with the same executable
  limitation. The focused access/PWA set passed all 43 tests.
- The new access-form Chromium regression passed on phone and desktop after
  failing with the original handler. Both worker regressions also failed before
  their respective fixes and passed afterward.
- The configured UX run passed 112 checks; seven visual comparisons initially
  lacked decoded baseline PNGs. After decoding the 12 committed baselines, all
  12 visual comparisons passed without changing their fixtures. All 119 configured
  paths therefore have passing local evidence. Both Calendar first-paint checks
  also passed. Exact-head CI must run the complete suite in one configured run.
- Authenticated synthetic Staff access and Clinic reports browser proofs passed
  on phone and desktop, with no live data or provider writes.
- Lint and maintenance configuration formatting passed. Storybook built.
- Before release, both production health endpoints returned successfully; private
  client/Workspace JSON endpoints were checked without a session, and application
  error logs since the preceding release returned no errors for the queried window.

Final browser counts, CI evidence and deployment verification are recorded in
#611 after completion, so this document does not assert an unverified release.

## Remaining acceptance and continuing assurance

On real devices, check JP’s Workspace and a separate client’s My Shiloh: close and
reopen, explicit sign-out, passkey sign-in, refresh/update, network loss/recovery,
notification consent and notification tap. Check iPhone Safari as well as the
Samsung installed app. Confirm a client’s acknowledgement/resolution reaches
Current updates and can be archived/restored. Use controlled accounts and obtain
specific authorization before creating live payment/provider events or changing
real appointments.

Keep these regressions in the release gates. Investigate newly reported failures
and sanitized production errors against the deployed revision; add a behavioral
regression when a defect is reproduced. The absence of errors in one log window
and passing automated tests increase confidence but do not replace ongoing
reports or real-device acceptance.
