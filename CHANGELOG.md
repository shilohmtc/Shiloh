# Changelog

All notable changes to Shiloh are documented in this file.

This project follows Semantic Versioning: MAJOR.MINOR.PATCH.

## [2.0.0] - 2026-09-13

### Unified Clinic Platform

Shiloh now operates as one integrated clinic platform rather than a collection of separate operating streams.

#### Added
- Complete public website with Home, Treatments, About, Contact and the canonical booking journey.
- Secure, mobile-first Shiloh Workspace and installable PWA for authorized clinic staff.
- Canonical Shiloh Calendar with Day, Week and Month views, staff-aware scheduling and guarded booking operations.
- CRM V2 client, appointment, service and staff foundations with capability-driven access.
- Atomic Couples Massage booking for two distinct client profiles and two eligible practitioners in one booking group.
- Self-service passkey sign-in and clearly identified device management.
- Maintained Assistant FAQ and policy foundations grounded in canonical clinic information.
- Production-backed Storybook component and journey catalogue.

#### Changed
- Retired Shiloh Control as a separate product concept in favour of a Shiloh-first operating model.
- Replaced legacy and emergency staff-authentication paths with the canonical passkey flow.
- Expanded client onboarding, booking, rescheduling, confirmation and practitioner workflows.
- Strengthened the public booking experience and practitioner/service eligibility handling.
- Kept Shiloh CRM as the booking source of truth with Google Calendar as a synchronized operational view.

#### Security and quality
- Added Playwright phone and desktop journey coverage with visual evidence.
- Added Storybook, axe-core accessibility checks and Lighthouse CI.
- Expanded GitHub Actions regression protection, dependency auditing, linting, formatting and unused-code checks.
- Hardened production dependencies and staff-session boundaries.
- Preserved exact-commit traceability and automatic Render deployment verification.

#### Release scope
- This release records the current Shiloh platform generation after 2,951 commits since v1.2.0.
- Historical handoffs and Control-era documents remain evidence, not current operating authority.

## [1.2.0] - 2026-08-11

### Production CRM & Customer Experience

#### Added
- CRM-backed booking and customer lifecycle with Shiloh replacing Goldie as the active booking system of record.
- Staff-scoped WhatsApp administration with owner/business-admin and practitioner-specific permissions.
- Dedicated Google Calendars for Marietjie and Abigail with practitioner-scoped appointment visibility.
- Public Shiloh booking landing page with direct WhatsApp AI booking intent.
- Public CRM-backed service catalogue with professional descriptions, service imagery and WhatsApp deep links.
- Versioned Booking Policy with explicit WhatsApp consent gate and safe synthetic production verification.
- Staff-scoped operational `Today` reporting with business-wide owner/admin summaries and practitioner-self summaries.
- Birthday customer-care foundations, opt-in/out controls, once-per-year delivery protection and Meta template provisioning workflow.
- Loyalty visit and reward foundations based on completed appointments.
- Walk-in QR registration and premium customer greeting flows.
- Client cancellation/rescheduling, booking confirmation, calendar-add and customer-care scheduling infrastructure.

#### Changed
- Retired Goldie from active production booking; historical Goldie data remains archival only.
- Established Shiloh CRM and Google Calendar as authoritative operational sources alongside GitHub `main` and Render production.
- Updated public booking branding to `Shiloh Massage Therapy and Aesthetic Clinic` and identified Shiloh as the AI assistant.
- Added the Shiloh booking URL as the preferred Google Business Profile booking link while Goldie provider-link removal completes.
- Hardened normal startup so only intended long-running production schedulers run automatically.

#### Production hardening
- Safe self-test-first engineering is now the authoritative change-management rule.
- Regression suite protects staff scope, calendar presentation, booking conflict guards, cancellation synchronization, post-cutover startup and maintenance safety acknowledgements.
- Fixed OpenAI language-guard compatibility by using the provider-supported minimum output-token budget while retaining fail-open WhatsApp availability.
- Removed temporary birthday-template startup inspection hooks after provider-side submission.
- GitHub CI and Render auto-deploy remain the release validation path.

#### Pending P3 work
- WhatsApp birthday template approval/configuration, including resolving the legacy clinic-name wording before enabling outbound birthday delivery.
- Treatment-aware aftercare and rebooking specialization.
- Loyalty redemption automation.
- Reporting expansion: Tomorrow → This Week → Services/Trends → Availability → optional weekly owner summary.
- Optional dedicated reminder-confirmation response state.

#### Next phase
- P4 Ozow/payment/voucher architecture remains unstarted and will begin with discovery/design, payment-ledger truth, webhook idempotency and voucher lifecycle design.

## [1.0.1] - 2026-08-07

### Maintenance
- Upgraded the official OpenAI JavaScript/TypeScript SDK from the 5.x line to `7.1.0`.
- Regenerated `package-lock.json` and verified a clean `npm ci` install on Node.js 24.14.1.
- Kept the existing Responses API integration and customer-facing behavior unchanged.

## [1.0.0] - 2026-08-07

### Shiloh AI Receptionist — Production Baseline

#### Added
- Meta WhatsApp Cloud API webhook integration and outbound messaging.
- OpenAI Responses API integration with persistent conversation continuity.
- PostgreSQL-backed long-term conversation memory and customer profiles.
- Clinic knowledge retrieval with vector search and Goldie knowledge synchronization.
- Clinic-only scope guardrails and business knowledge prioritization.
- Intelligent booking preference collection, service validation, date/time parsing, therapist preferences, confirmation summaries, and Goldie handoff.
- Existing-appointment reschedule and cancellation flows with persistent state and confirmation safeguards.
- Appointment lifecycle infrastructure for reminders and post-visit follow-ups.
- Customer Experience Intelligence: ratings, private feedback collection, Google review workflow, unresolved-feedback tracking, and admin analytics endpoints.
- Protected admin API endpoints and production health endpoint.
- Structured production logging and OpenAI token-usage observability.

#### Production hardening
- Render Starter deployment baseline.
- Node.js runtime pinned to 24.14.1.
- Deterministic production installs via `npm ci`.
- Render health checks configured to `/health`.
- PostgreSQL persistence verified across service restarts.
- Automatic GitHub-to-Render deployments.

#### Notes
- WhatsApp proactive reminder/follow-up templates are prepared in Meta and can be enabled once approved.
- Goldie remains the booking system of record for v1.0.0 while Project Shiloh OS is developed as the long-term replacement.

