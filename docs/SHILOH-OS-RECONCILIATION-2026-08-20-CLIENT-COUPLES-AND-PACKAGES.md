# Shiloh OS — Reconciliation — Client Couples & Packages

Date: 2026-08-20
Owning workstream: Booking & Admin UX

## Controlled result

PR **#378 — Add Couples & Packages to Massage Treatments** merged as application SHA **`aa7f692b35bc7acaafbea74d45f752c2b99a886d`**.

The client-facing **Massage Treatments** journey now presents **Couples & Packages** as its first special option. Opening that row presents, in order:

1. **Couples Massage**
2. **Sports Massage Package**
3. **Back**

Ordinary single-client massage treatments remain on the existing Massage Treatments pages beneath that first special option.

## Couples Massage boundary

No authoritative canonical multi-person/simultaneous-resource Couples Massage booking service was established by the inspected CRM-backed booking architecture. #378 therefore does **not** invent a service row, service ID, price, duration, practitioner mapping, simultaneous-resource algorithm or appointment type.

Selecting **Couples Massage** is intentionally assisted-only. Shiloh explains that coordinated practitioner/treatment-space availability is required, directs the client to contact Shiloh on the existing business contact number, explicitly states that no booking has been created, and offers Back to Couples & Packages.

A later true self-service Couples Massage workflow would require a separately authorized data/booking contract for two clients and coordinated simultaneous resources. #378 is not evidence that such a contract exists.

## Sports Massage Package authority

**Sports Massage Package** reuses the existing canonical package owner and entitlement flow. It does not duplicate package data into presentation code.

Production startup after #378 reverified the current canonical package rule:

- slug: `sports-massage-monthly`
- name: `Sports Massage — Monthly Package`
- package-session service: **#65**
- package price: **R1400**
- included sessions: **4**
- validity: **30 days**
- cancellation notice: **24 hours**
- status: **active**

The Couples & Packages submenu derives its Sports package summary from the active package row. If that canonical package is missing/inactive, the Sports package option is omitted rather than fabricated. Existing entitlement checks, enquiry/buy behavior, package status and package-session booking authority remain with the established package service.

## Regression gate

The initial #378 CI run **#1187** exposed one new-test presentation mismatch only: the test expected `R1,400`, while the existing canonical package presentation convention is `R1400`. No runtime implementation defect was established. The new test was corrected to preserve the existing convention.

Final PR #378 CI run **#1188** completed successfully.

Regression coverage includes:

- Couples & Packages is the first Massage Treatments special row;
- the legacy visible Massage Packages row is replaced rather than duplicated;
- submenu order is Couples Massage → Sports Massage Package → Back;
- Sports package summary is derived from canonical package data;
- missing/inactive package fails closed by omission;
- later Massage Treatments pages remain unchanged;
- Couples Massage creates no ordinary booking and clearly remains assisted-only;
- existing Sports package actions remain intact;
- production/dev preload wiring includes the bounded presentation patch.

## Production verification

Render auto-deploy **`dep-da3kik67bikc7384a7vg`** reached **LIVE** on exact #378 merge SHA **`aa7f692b35bc7acaafbea74d45f752c2b99a886d`** in confirmed workspace **My Workspace**.

Production evidence established:

- Render checked out exact #378 SHA;
- build completed successfully;
- `npm start` explicitly preloaded `src/bootstrap/clientCouplesPackagesPatch.js`;
- Shiloh started normally;
- repeated `/health` probes returned HTTP 200;
- Google Calendar provider health passed;
- migration 061 Massage Packages remained checksum-valid;
- Juvan controlled identity remained BOUND to the current pointer (presently client 845 / suffix 1564 / JP admin 4) with assigned-practitioner Primary + Jean-Pierre Backup + first-decision-wins authority unchanged;
- practitioner-approved client rescheduling remained `featureEnabled=false`;
- migration 069 remained checksum-valid with service #31 active, Abigail still `abigailMapped=false`, Christel still the active/client-bookable Jaw Release mapping, and 13 linked appointments preserved.

No appointment, Calendar event, package entitlement, CRM client/service row, provider template, practitioner decision or genuine handset journey was manufactured merely to prove this presentation change.

## Durable authority / non-goals

Preserve the following until explicitly superseded:

- Client **Massage Treatments** places **Couples & Packages** first.
- Couples & Packages contains **Couples Massage**, **Sports Massage Package**, then **Back**.
- Couples Massage remains assisted-only until a separately authorized canonical multi-client/simultaneous-resource booking contract exists.
- Sports Massage Package continues to use the canonical `sports-massage-monthly` package and existing entitlement/session flows.
- Do not create a second static catalogue or duplicate package ledger.
- Do not invent Couples Massage price, duration, practitioners or service identity merely to make it self-service.
- #378 does not alter ordinary massage service IDs, prices, durations or practitioner mappings.
- #378 does not alter package price/rules/entitlements or service #65 authority.
- #378 does not alter Google Calendar, Meta/provider state, Juvan approval authority, Abigail Jaw Release mapping, Admin UX authority, or the practitioner-approved reschedule gate.

## Controlled checkpoint

**Completed:** code, regression, merge and exact-SHA production verification for the Couples & Packages client presentation.

**Application authority:** PR #378 / `aa7f692b35bc7acaafbea74d45f752c2b99a886d`.

**Production:** Render `dep-da3kik67bikc7384a7vg` LIVE on exact application SHA, startup healthy and `/health` 200.

**Future boundary:** do not turn Couples Massage into ordinary self-service without separate business/data/availability design authority for two clients and coordinated resources.


## Accepted package and Workspace standard — 5 October 2026

Jean-Pierre approved R1,400 upfront for four Sports Massage treatments of 45–50 minutes, any four within one calendar month of the first treatment. Calendar reservations use a 50-minute slot. This supersedes the earlier 30 days from payment/activation rule for new purchases; existing purchased windows remain unchanged.

Workspace Services separates ordinary treatments from package offers. The existing `sports-massage-monthly` definition and its session service remain the sole package authority. The exact duplicate ordinary monthly offering is recoverably deleted. Internal prepaid session services are excluded from ordinary catalogue lists and protected against service deletion.

Services deletion is recoverable from Deleted, preserves history and practitioner assignments, and restores to Inactive. Package deletion retires the offer while preserving paid treatments; restoring makes the offer available again.

Clinic staff with existing Services management and creation capabilities can create reusable packages in Workspace. A paid purchase additionally requires existing payment collection and client lookup authority, a selected clinic client, payment method, receipt reference and explicit confirmation of full upfront receipt. Offer revisions are checked before payment is recorded. Package receipts join the clinic financial reports once at purchase; session bookings incur no further payment. No provider checkout or automatic refund policy is introduced.

Each purchase snapshots its price, treatment count, wording and validity. Bookings reserve a credit atomically; completion consumes it; existing cancellation/no-show releases remain unchanged. The first completed treatment establishes the calendar-month window using its appointment time. Proposed bookings and rescheduling must fit the same window; the first planned booking alone does not start expiry. Concurrent bookings cannot allocate more than the purchased credits. My Shiloh shows available/booked/used credits and expiry and uses the existing appointment approval flow.

Implementation checkpoint: prepared on `feat/workspace-packages`; database, interface and exact-head release checks are required before production verification. Deployment evidence will be recorded on the release PR.
