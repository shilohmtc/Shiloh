# Shiloh public website V1

## Outcome

The existing Render web service serves the public website at `https://shilohmtc.co.za/` and the installed apps at `https://app.shilohmtc.co.za/` while preserving the established booking, workspace, database, branch and webhook behavior.

Public routes:

- `/` — Home
- `/treatments` — the current client-bookable catalogue
- `/about` — clinic introduction
- `/contact` — visit and booking guidance
- `/book` — the existing canonical booking experience
- `/visit` — Heidelberg visitor guidance
- `/privacy` — privacy information
- `/robots.txt` and `/sitemap.xml` — public search discovery

## Authority boundaries

- Treatments, timing and prices come from `getPublicServiceCatalogue()`.
- Public website pages do not query availability, create appointments or write to the database.
- `/book` remains the canonical client booking handoff.
- `/health`, `/calendar`, `/admin`, Meta webhooks and the service/database topology are unchanged.

## Release and rollback

This release changes only application routes and presentation. It does not change DNS or create another Render service.

For this audit follow-up, rollback is a normal revert of its merge commit on a schema-compatible current release. Preserve booking data, staff access, integrations and subsequently released work.

The existing host middleware sends public-page requests on the app hostname to the public root domain. Installed apps and passkeys retain their app origin. This follow-up does not change DNS or move either app.

## Accepted audit follow-up — 22 October 2026

Keep Shiloh's colours, approved photography and serif headings. Public Home and booking guidance names the current WhatsApp-code/saved-passkey entry, not retired biographical sign-in. Keep installation instructions in the existing My Shiloh guide. Remove the repeated site-wide app banner; retain the Home/Contact app cards and navigational app links. The photographic location band holds the footer address once. Condense primary navigation through medium widths without hiding Book, My Shiloh or Staff Workspace from the menu. Contact uses a full-width address above two balanced contact/booking cards, stacking on phones.

Search Console readiness uses `/robots.txt` and `/sitemap.xml` on the canonical public origin `https://shilohmtc.co.za`. The sitemap lists only Home, Services, About, Contact, Visit, Privacy and the public booking catalogue. It includes no client records, staff routes, forms, payments, query parameters or fabricated last-modified dates. App-host requests for these two discovery files redirect to the public origin, like other public pages. Existing authentication and noindex controls remain unchanged; a sitemap is not an access-control mechanism.

Search Console ownership is **unconfirmed**, not complete. No Search Console or DNS connector is available in this task. The remaining owner step is to open https://search.google.com/search-console and check whether the Domain property `shilohmtc.co.za` is verified. If absent, add that property and install Google's exact generated DNS TXT record through the domain provider; never invent a verification value or replace existing records. After verification, submit `https://shilohmtc.co.za/sitemap.xml` and inspect the public Home page. Account verification, successful submission and indexing require their own evidence. Official instructions: https://support.google.com/webmasters/answer/9008080 . No Google tracking script or Microsoft Clarity is installed. Clarity privacy review and deferred backup/recovery work remain separate.
