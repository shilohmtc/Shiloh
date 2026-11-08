# Group enquiry booking handover

Arrange booking on a group enquiry opens the existing Group booking workflow with its verified enquiry contact and requested date. The organiser is shown separately and is never added as a treatment guest automatically. Staff explicitly select the actual guests, treatments, eligible practitioners and times, then review and confirm the whole group. The existing 3–10 guest limit remains; an approximate enquiry count does not increase that limit or complete the enquiry automatically.

The request ID is resolved on the server using current Reception planning, client lookup and group organiser authority, active clinic-client identity and compatible existing storage. Caller-provided identities, dates and return URLs do not replace the request context. The organiser and enquiry revision are rechecked at prepare and inside confirmation. Opening the page changes no client, booking or enquiry record. An organiser explicitly selected as a guest retains the original canonical profile.

After a successful group booking, staff return to the originating request and explicitly choose its linked group before confirming the enquiry arranged. The first appointment represents the group in this existing completion workflow, but every member must still be an approved upcoming appointment and the group must belong to the verified organiser. Individual requests retain their own-client rule. The organiser relationship records contact, not attendance. The booking audit retains the originating enquiry ID.

Direct-contact guests retain their existing confirmations. Guests without mobiles retain their existing organiser notice. Merely carrying an enquiry organiser does not add an organiser message or share private treatment information. No schema migration, payment or pricing policy, access grant, authentication setting, or production client-data operation is part of this change.

## Interrupted and repeated actions

The fixed Back to request action discards a pending review successfully before leaving and stays on the form on failure. Repeated review clicks are blocked while a check is in flight; edits invalidate the response. Confirmation uses the exact server-issued review key. An uncertain result keeps the existing recovery lock, including after refresh, and checks the original booking instead of creating another. The verified confirmation/replay response supplies the original enquiry ID so recovery opened from another enquiry cannot redirect to the wrong request.

## Validation and release evidence

Synthetic SQL tests cover separate organiser/attendee identities, unchanged organiser profile, direct and no-mobile groups, stale context, revoked authority, exact replay, and explicit group completion including invalid siblings. Route tests retain session, origin and CSRF checks and prove context opening is read-only. Production-backed Storybook and phone/desktop browser cases cover blank guests/treatments, editable dates, explicit organiser attendance, exact prepare payload, accessibility, safe return, in-flight edits and interrupted confirmation.

The source-bound Rebook proof accepts only the exact synthetic group request destination and return anchor change. Negative tests continue to reject changed identities, dates, actions, fields and scripts. Required exact-head CI, screenshot review, merge, deployment identity and live verification are recorded on the PR; local synthetic checks do not claim production or physical-device acceptance. No real booking or client message is used for testing.
