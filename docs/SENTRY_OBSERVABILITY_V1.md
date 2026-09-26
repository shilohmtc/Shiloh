# Shiloh Sentry Observability V1

This integration reports unhandled Node.js/runtime errors, startup failures, and errors that reach the final Express error handler. Unexpected PostgreSQL pool errors and failed scheduled booking-integrity scans are also captured with controlled error-kind/code tags. It does not add tracing, replay, log forwarding, provider monitoring, or business analytics.

## Privacy boundary

Sentry is initialized with `sendDefaultPii: false`, zero breadcrumbs, and a deliberately small integration allowlist. Automatic request data, HTTP, console, local-variable, and module inventory integrations are excluded.

Before an event can be sent, Shiloh rebuilds it from an allowlist. It retains only:

- error type and a generic error description;
- application stack filenames, function/module names, and line/column numbers;
- environment and release identifiers;
- controlled error kind/code, runtime phase, HTTP method, and declared Express route tags.

It removes raw exception messages, request URLs/query strings, headers, cookies, bodies, user data, breadcrumbs, arbitrary contexts/extras, source context, and local variables. Do not add client identity, WhatsApp content, appointment notes, tokens, provider payloads, or other clinic/client data to Sentry tags or contexts.

## Render configuration

Required to enable Sentry:

- `SENTRY_DSN` — copy the DSN for the owner-created Sentry Node.js project into the Render web service environment. Treat it as runtime configuration and do not commit it.

Optional:

- `SENTRY_ENVIRONMENT` — defaults to `NODE_ENV`, then `production`.
- `SENTRY_RELEASE` — defaults to Render's existing `RENDER_GIT_COMMIT` value.

No other Render variable is required for V1. With `SENTRY_DSN` unset or blank, Sentry remains disabled and application startup/capture/flush behavior stays harmless.

## Owner setup

1. Sign in to the owner-approved Sentry organization, or create one under the intended owner account.
2. Create a new project using the **Node.js** platform. Use a clear name such as `shiloh-production` and select the owner-approved team.
3. In Sentry project settings, keep IP address storage disabled and review data-scrubbing rules as a second server-side safeguard.
4. Copy the project's DSN. Do not paste it into GitHub, chat, logs, tests, or source files.
5. In Render, open the production `shiloh-whatsapp-bot` web service, then **Environment**.
6. Add secret environment variable `SENTRY_DSN` with the copied DSN. Optionally add `SENTRY_ENVIRONMENT=production`; no release variable is needed when `RENDER_GIT_COMMIT` is available.
7. Save only after Control approves release/configuration. The resulting restart/deploy must be verified against the exact approved release SHA.
8. After release, use a deliberate non-sensitive test error path or another Control-approved synthetic check; never submit a real client message or appointment as test data.

## Alert and response check

Sentry initialization in Render proves that the application attempted to enable monitoring; it does not prove event delivery or alert routing. In the owner-approved Sentry project, check that new production issues notify the responsible operator, verify the destination with a safe synthetic event, and record who acknowledges and follows up. Keep client data out of test events. For database-pool and booking-integrity-scan issues, check Render logs and `/health` using the event release and safe error kind/code; review the existing Workspace problem reports and booking-integrity exceptions where relevant. Do not automatically retry a booking, payment, or message action based only on a Sentry event.

## Rollback

Remove or blank `SENTRY_DSN` in Render and restart the service. The integration then becomes a no-op. If code rollback is also required, revert the observability commit and reinstall from the prior lockfile. No schema, migration, datastore, provider asset, or business-authority rollback is involved.
