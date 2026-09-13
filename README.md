# Shiloh

[![CI](https://github.com/shilohmtc/Shiloh/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/shilohmtc/Shiloh/actions/workflows/ci.yml)
[![Storybook UX](https://github.com/shilohmtc/Shiloh/actions/workflows/storybook.yml/badge.svg?branch=main)](https://github.com/shilohmtc/Shiloh/actions/workflows/storybook.yml)
[![Production Lighthouse](https://github.com/shilohmtc/Shiloh/actions/workflows/lighthouse.yml/badge.svg?branch=main)](https://github.com/shilohmtc/Shiloh/actions/workflows/lighthouse.yml)

Shiloh is the digital operating system for Shiloh Massage Therapy and Aesthetic Clinic—bringing together client care, bookings, CRM, staff operations and the customer-facing WhatsApp AI assistant.

[Visit Shiloh](https://app.shilohmtc.co.za) · [Book an appointment](https://app.shilohmtc.co.za/book)

## Shiloh-first model

- **Public website and booking** — the client-facing Home, Treatments, About, Contact and canonical Book journey.
- **Shiloh Workspace** — the secure operating surface for authorized clinic staff.
- **Shiloh AI Assistant** — the customer-facing WhatsApp assistant.
- **Shiloh CRM** — the authoritative booking and client-data layer.
- **Operational integrations** — Google Calendar synchronization, Meta WhatsApp Cloud API and Render hosting.

Governance, engineering, release decisions and production evidence support Shiloh as one clinic platform; they are not separate products.

## Sources of truth

- The canonical Services authority owns treatment names, durations, prices and practitioner eligibility.
- Shiloh CRM owns booking and client records.
- Google Calendar is a synchronized operational view, not the primary database.
- Owner-provided business facts and hospitality policies remain authoritative.
- Current `main`, active issues, pull requests and production evidence define the current engineering state.

## Quality standard

Shiloh's interface work is backed by:

- **Playwright** for real browser journeys, responsive behaviour and visual evidence.
- **Storybook** for production-backed component and page states.
- **axe-core** for automated accessibility checks.
- **Lighthouse CI** for public-site quality monitoring.
- **Node.js tests and GitHub Actions** for regression and integration protection.

Meaningful interface changes should cover normal, loading, empty, validation, error and permission-limited states where relevant, with phone and desktop proof.

## Runtime

- Node.js 24
- Express
- PostgreSQL
- Meta WhatsApp Cloud API
- OpenAI Responses API
- Google Calendar OAuth integration
- Render production hosting

## Production safeguards

- Staff and service authorization is enforced before booking mutations.
- Migration and reconciliation work must not send client messages unless explicitly intended.
- Secrets and raw client exports must never be committed to Git.
- Production changes must remain traceable to an exact commit and verified after deployment.

## Historical references

Dated handoffs and migration documents record earlier checkpoints. They remain historical evidence rather than the current operating authority.

- [August 11 handoff](docs/HANDOFF-NEXT-CHAT-2026-08-11.md)
- [Goldie migration/reference manifest](docs/GOLDIE-EXPORT-MANIFEST-2026-08-10.md)
