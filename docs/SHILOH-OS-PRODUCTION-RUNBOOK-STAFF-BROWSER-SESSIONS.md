# Shiloh OS — Production Runbook — Staff Browser Sessions

Date: 2026-08-24
Owner: **40 — Production & DevOps**
Unit: `SHILOH-STAFF-BROWSER-SESSION-BOUNDARY`

## Security boundary

Staff browser authentication uses server-side opaque sessions. The browser receives only a high-entropy opaque token in a cookie; production persists only its SHA-256 hash together with bounded issue/expiry/revocation/last-used metadata. Authentication challenges and CSRF values are likewise persisted only as hashes.

The production session cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, bounded by `Max-Age`, and has no `Domain` attribute. Session tokens must never be placed in URLs, localStorage, or sessionStorage.

The former `ADMIN_API_KEY` / `x-admin-key` server/API boundary was retired by #990 and must not be restored or repurposed as browser identity. Staff browser authentication continues to use Shiloh's canonical session, capability, same-origin and CSRF boundaries.

State-changing authentication/session endpoints require same-origin JSON requests. Authenticated mutations additionally require the per-session CSRF token. Malformed, tampered, expired, revoked, inactive-account, or privilege-revoked session state fails closed.

## Current authorization derivation

Every session validation re-resolves the active `staff_admin_accounts` principal and current canonical staff state. Browser-supplied staff IDs, role names, or Calendar scope do not establish authority.

Calendar viewer authority is derived from the existing canonical staff/Admin scope model:

- current `calendar_scope = all_business` business-wide authority → `business_all_staff`;
- current `calendar_scope = own` with a canonical active linked staff profile → `own_staff` plus canonical `staffId`;
- otherwise no trusted Calendar viewer is established.

## WhatsApp challenge delivery

Challenge delivery uses the existing `sendWhatsAppMessage` provider abstraction only behind the explicit default-off gate:

`SHILOH_STAFF_BROWSER_AUTH_WHATSAPP_DELIVERY_ENABLED=true`

The gate must remain unset/false until Control separately authorizes genuine provider delivery. Deployment, startup, migration, health checks, and automated tests must not send an authentication message. Tests inject a mock provider only.

No new WhatsApp secret is introduced by this unit. Challenge codes and recipients must not be logged by the staff-session layer.

## Calendar double gate

Staff-session Calendar bridging has its own default-off gate:

`SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED=true`

The existing Calendar read-only feature gate remains separately binding:

`SHILOH_CALENDAR_READONLY_UX_ENABLED=true`

Both gates are required before a valid staff session may establish the trusted `Symbol.for('shiloh.calendar.server.viewer')` context. Implementing staff sessions does **not** authorize enabling either production Calendar gate. `/calendar/:token.ics` remains the existing independent tokenized ICS surface.

## Schema deployment

`migrations/078_staff_browser_sessions.sql` creates hash-only challenge/session storage. `scripts/ensure-staff-browser-sessions.js` applies and checksum-verifies exactly migration 078 during normal application startup before the server starts. A checksum mismatch or migration failure fails startup closed.

## Production verification

For an implementation deploy, verify all of the following before reconciliation:

1. exact merged commit is LIVE on Render;
2. migration 078 is applied and checksum-valid;
3. startup completes and `/health` returns HTTP 200;
4. Google Calendar provider health remains healthy under existing authority;
5. bounded deploy/startup logs contain no unexpected errors;
6. no staff authentication WhatsApp message is emitted merely by deployment/startup;
7. staff-session Calendar bridge remains default-off;
8. Calendar read-only UX remains separately gated/not generally staff-accessible;
9. focused session/security tests and full regression are green.

Real WhatsApp challenge delivery and general staff Calendar activation are separate Control decisions.
