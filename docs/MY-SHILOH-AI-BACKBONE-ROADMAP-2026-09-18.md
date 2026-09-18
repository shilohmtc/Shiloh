# My Shiloh — AI Backbone Roadmap

Date: 18 September 2026  
Status: ACTIVE product and engineering direction

## Product doctrine

My Shiloh is not a traditional client portal with unrelated screens and a chatbot added beside them.

**Shiloh is the client-experience backbone.**

- **WhatsApp is the front door.**
- **My Shiloh is the client's home.**
- **Shiloh AI understands, prioritises and explains.**
- **Canonical domain services remain the authority for truth and mutations.**
- Home, Bookings, Forms, Payments and future client actions are projections/actions over the same authenticated client context.

The assistant must never become the booking database, payment ledger, consultation-form authority or scheduling authority.

The operating pattern is:

> Understand → read canonical truth → explain/prioritise → prepare action → explicit client confirmation where required → canonical authority executes → Shiloh explains the result.

## Client identity boundary

My Shiloh client context is derived only from the validated client browser session.

The browser never supplies a trusted client ID.

The server resolves:

`client browser session → crm_v2_client_id → canonical client-owned data`

Client-facing context must remain fail-closed and minimal. It may expose presentation-safe appointment/form/payment status to the authenticated client, but must not expose consultation answers, practitioner clinical records, payment-provider payloads, staff/Admin authority, raw security records or internal audit data.

## Shared client context

Create one reusable read-only projection for authenticated clients.

Initial context:

- CRM V2 display identity;
- next canonical appointment;
- appointment service and practitioner snapshots;
- consultation-form assignment **status only**;
- payment position derived from the canonical payment ledger;
- active secure Shiloh payment path when one already exists.

Do not read or send to general AI context:

- encrypted consultation answers;
- practitioner clinical/assessment records;
- raw payment-provider events;
- payment ledger notes/internal evidence;
- staff/Admin data;
- unrelated historical client data.

## Shiloh orchestration layer

A client-experience orchestrator consumes the shared context and decides what deserves attention.

Examples:

- no upcoming booking → offer booking;
- form waiting → surface the form task first;
- existing secure payment link → surface payment next;
- otherwise → reassure the client that the upcoming visit is ready;
- generate context-aware suggested questions for Shiloh.

This first orchestrator is deterministic by design. It establishes the trusted context/action contract before free-form model reasoning is allowed to act on personal data.

The existing WhatsApp Shiloh/OpenAI intelligence remains the AI foundation. Do not create a second independent My Shiloh AI brain.

## Surface model

### Home

Home answers:

> **What matters to me right now?**

It consumes the shared experience model and surfaces the highest-value client state.

### Bookings

Bookings is the factual visual timeline and fallback for clients who prefer browsing.

It consumes the same context/booking projection used by Shiloh. It must not implement independent appointment lookup or scheduling logic.

### Shiloh

Shiloh is the conversational interface over authenticated context.

The in-app assistant should ultimately continue the same Shiloh relationship as WhatsApp, while keeping browser-session ownership and privacy boundaries explicit.

### Profile

Profile remains account/security/preferences and durable client settings. It is not a competing source of operational truth.

## Roadmap

### Phase 0 — Foundation — VERIFIED LIVE

- My Shiloh PWA shell.
- Separate client browser-session authority.
- WhatsApp-backed CRM V2 authentication.
- Website entry points into My Shiloh.
- PWA private APIs excluded from service-worker cache.

### Phase 1 — Authenticated Client Context + Experience Orchestrator — ACTIVE

Build:

- one CRM V2 session-owned client context service;
- one Shiloh client-experience orchestrator;
- protected network-only `/my-shiloh/api/experience`;
- Home, Bookings and Shiloh suggestions consuming that same experience model;
- read-only facts only;
- no new database authority and no mutation path.

Acceptance:

- browser cannot choose another client;
- next appointment comes from canonical appointments;
- form status comes from assignment metadata only;
- payment position comes from payment authority tables;
- no health answers or practitioner records are read;
- no provider payloads are exposed;
- phone and desktop browser proof passes.

### Phase 2 — Authenticated In-App Shiloh Conversation

Reuse the existing Shiloh/OpenAI intelligence instead of building a separate assistant.

Add:

- authenticated My Shiloh conversation endpoint;
- trusted client context passed server-side only;
- same business knowledge, catalogue and practitioner authority as WhatsApp;
- bounded personal context, never wholesale CRM rows;
- no domain mutations from model text alone.

WhatsApp and My Shiloh should feel like the same Shiloh relationship, even when the UI surface differs.

### Phase 3 — Read Tools

Give Shiloh explicit, typed read tools over canonical services, for example:

- `get_my_next_appointment`
- `get_my_upcoming_bookings`
- `get_my_form_status`
- `get_my_payment_status`
- `find_available_slots`
- `get_my_package_status`
- `get_my_vouchers`

Every tool automatically receives the authenticated client identity from server authority.

### Phase 4 — Confirmed Client Actions

Add bounded action tools only after the read model is stable.

Examples:

- prepare reschedule;
- confirm reschedule;
- prepare cancellation;
- confirm cancellation;
- open/issue an authenticated form access path;
- open an existing payment request;
- prepare a new payment request under approved payment rules.

Consequential mutations require explicit confirmation UI and canonical domain guards. AI may propose; domain authority decides and executes.

### Phase 5 — WhatsApp ↔ My Shiloh Deep Linking and Adoption

Do not force app installation.

Use WhatsApp contextually:

- **View booking**
- **Open My Shiloh**
- **Complete form**
- **Pay securely**
- **Manage appointment**

Inside the active WhatsApp customer-service window, ordinary replies/deep links can guide clients naturally into My Shiloh.

Outside that window, use approved transactional templates where the message is legitimately tied to an appointment/form/payment lifecycle. Do not create generic marketing pressure merely to drive installs.

Prompt Home Screen installation only after the client has experienced value.

### Phase 6 — Proactive Shiloh

Once the authorities and consent rules are proven, Shiloh can proactively summarise meaningful client state:

- tomorrow's appointment;
- outstanding client action;
- package balance;
- useful post-visit follow-up.

This remains event/authority-driven, not speculative AI outreach.

## Architecture rule

Do **not** build:

- a separate Home appointment query;
- a separate Bookings appointment query;
- a separate AI payment calculator;
- a separate Forms status implementation;
- a separate My Shiloh scheduling engine;
- a second AI persona/model stack for the app.

Build reusable context/tool/domain boundaries once, then let each surface consume them.

## North-star experience

A client should be able to enter through WhatsApp, the website or the My Shiloh icon and still feel that they are dealing with **the same Shiloh**.

The interface changes.

The relationship, identity, authority and truth do not.
