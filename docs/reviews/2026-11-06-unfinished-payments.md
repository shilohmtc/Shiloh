# Unfinished payments review

Local implementation; not released. See #611 for the eventual deployment evidence.

The dashboard opens one review page for completed-visit balances and payment exceptions, with upcoming deposits in a separate section. Existing deposit disclosure, refresh, review, waiver and booking actions remain available. A future deposit is never described as overdue treatment debt.

The reader uses current payment:view, client:lookup and appointment:view with clinic-wide Calendar/service scope, within a repeatable-read READ ONLY transaction. Every shared member must be in scope; private subjects are excluded before pagination. Canonical bookingPayments positions account for recorded receipts/refunds, prior payment and applied vouchers, rewards and credit. Unused credit is not treated as settlement. Shared accounts are shown once; mixed outcomes, historical linkage, uncertain price/currency and provider-paid-without-ledger evidence are review states without fabricated amounts. Historical exception records remain labelled recorded exceptions, not proof of newly uncaptured cash.

Pages examine at most 25 canonical subjects, with 2-second SQL statement timeouts, a 5-second processing budget, disconnect checks and 100-member cap. The list is ordered by stable booking identifier for pagination, not by overdue priority. Settled candidates can produce an empty page with a next-page link. No clinic-wide outstanding count or sum is claimed. Timeout/failure yields unavailable, never all paid. This is not an accounting aging report or a reconstruction of unrecorded cash.

The existing payment page retains appointment-price review and payment authority. An allowlisted origin link returns to this review page, preserving pagination. Successful deposit waiver returns to that origin only after canonical success; reason, explicit confirmation, revisions and retry operation IDs remain unchanged. Failures/uncertain responses keep the form and existing retry guidance.

Validation so far:
- Six service tests, including executable synthetic PostgreSQL SQL and the real canonical ledger, cover partial cash, applied rewards, shared balance once, missing receipt evidence, permission revocation and private group-member exclusion.
- HTTP/presentation tests cover session actor, unavailable deposits versus unavailable balances, cursor validation, safe return paths and preservation of appointment-price review.
- Six new browser scenarios cover phone/desktop accessibility, unknown/restricted/empty states, and uncertain waiver retry with identical operation ID before return.
- Existing deposit refresh/organization scenarios preserved. Authenticated synthetic Dashboard phone/desktop captures were reviewed with the new overview entry and retained deposit controls. Two initial failures were ambiguous Review payment versus new Review payments locators; exact singular matching retains their original destination checks and both reruns pass.
- Screenshot review found mobile menu overlap and deposit-name spacing; fixed in the page styles with a mobile non-overlap assertion. Corrected 390px and 1440px captures reviewed: menu/Back control no longer overlap, names and service details are separated, no horizontal clipping; both accessibility scenarios pass. Storybook uses the existing static brand asset mapping.
- Final lint and Storybook build passed. Full regression passed: 3,479 passed, zero failed, one existing skip (1,050.6 seconds). Subsequent presentation-only copy/spacing changes passed the seven focused presentation/organization checks; the required exact-head CI remains the final source gate. Rebased onto released booking merge 72504cc5ffa4ed0a1c5579a9ed1490d6d5c78a24; both new Playwright entries retained. All 17 focused integration checks and all 10 combined booking/payment browser scenarios pass; Storybook rebuilt successfully. Required exact-head CI remains mandatory before release.

No real client, appointment, payment, waiver or notification was changed for testing. No schema, access, credential or security configuration changes. Signed-in production acceptance remains distinct from synthetic evidence.
