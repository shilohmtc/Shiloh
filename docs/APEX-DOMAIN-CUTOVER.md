# Shiloh apex-domain cutover

## Outcome

`https://shilohmtc.co.za/` is the canonical public website origin. The existing
`https://app.shilohmtc.co.za/` origin remains available during the transition for
My Shiloh, Workspace, installed PWAs, private forms, webhooks and provider callbacks.

## Application routing boundary

Only idempotent `GET` and `HEAD` requests for public website pages redirect from
`app.shilohmtc.co.za` to the root origin:

- `/`
- `/about`
- `/book`
- `/contact`
- `/privacy`
- `/treatments`
- `/visit`

The redirect preserves the path and query string. It deliberately excludes all
other paths and every non-idempotent request so existing browser sessions,
installed applications, Meta webhooks, Ozow notifications and private links do
not cross origins unexpectedly.

## Render and DNS cutover

1. Add `shilohmtc.co.za` to the existing `shiloh` Render web service.
2. Apply the exact apex and `www` DNS records shown by Render. Remove conflicting
   records and any apex or `www` `AAAA` records before verification.
3. Verify the root domain in Render and wait for its managed TLS certificate.
4. Prove root `/`, `/book`, `/my-shiloh/`, `/health` and static assets over HTTPS.
5. Keep `app.shilohmtc.co.za` attached to the same service.
6. Deploy this application commit only after the root host is healthy.

Render automatically redirects HTTP to HTTPS and, when the apex is added as the
primary custom domain, redirects `www` to the apex.

## Provider and installed-app preservation

- Keep `SHILOH_PUBLIC_BASE_URL=https://app.shilohmtc.co.za` during this first
  cutover so new Ozow requests continue using the production-approved callback
  origin.
- Keep the current Ozow Success, Cancel, Error and Notify URLs active.
- Keep fixed Meta template URLs for payments and consultation forms on `app.`.
- Existing My Shiloh and Workspace installations remain origin-bound to `app.`.
- New root-domain My Shiloh visits work on the same service, but moving existing
  installations or provider callbacks is a separate, explicitly verified release.

## Release gate

- Focused redirect and public website tests pass.
- Full Node test suite, lint, formatting and unused-code checks pass.
- Storybook builds successfully.
- Desktop and phone public-site Playwright proof covers root canonical metadata,
  public redirects and preserved app-only routes.
- Exact-head CI is green before merge.
- Render deploy reaches `live` for the exact merge commit.
- Production root, `www`, `app.`, My Shiloh, health, redirects and provider
  callback passthrough are verified after deployment.

## Rollback

Revert the application commit to stop public-path redirects and restore `app.`
canonical metadata. Keep both Render custom domains and DNS records attached
during rollback; removing a domain is not required to restore application
behavior.
