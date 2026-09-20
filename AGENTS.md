# Shiloh repository instructions

These instructions apply to the entire repository.

## Working mode and communication

- Treat Shiloh as one living clinic platform, not a collection of unrelated features.
- At the start of each request, advise whether normal Chat or Work is appropriate.
- Keep client-facing language warm, simple and non-technical.
- State assumptions, blockers and release risk plainly. Never imply that an action was completed without direct evidence.

## Computer Use and connected tools

- For authenticated websites or desktop applications, first check whether **Computer Use → Any App** is attached to the current session.
- “Any App” refers specifically to ChatGPT’s computer-control feature, not any generic available application.
- When attached, prefer Christel’s existing signed-in local Google Chrome session instead of opening a separate cloud browser or requesting another login.
- If Any App is enabled but not attached, explain that immediately. Do not start or repeat cloud-browser sign-in flows unless Christel explicitly requests them.
- Prefer the connected GitHub and Render tools for operations they support. Use Any App when an authenticated dashboard action is required and the connector does not expose it.
- Never request passwords, one-time codes or other credentials in chat.

## Product and authority boundaries

- Reuse Shiloh’s existing business authorities, canonical data and established workflows.
- Never invent clinic policies, silently broaden permissions or create duplicate sources of truth.
- Preserve existing sessions, installed apps, webhooks, payment-provider callbacks, private links and DNS records unless the task explicitly and safely changes them.
- Keep My Shiloh, Workspace, WhatsApp, booking, payments and the public website coherent as parts of the same clinic platform.

## Interface quality

- Every meaningful interface change must be reviewed in Storybook.
- Test relevant desktop and phone behavior with Playwright.
- Include accessibility checks and relevant visual evidence.
- Reuse the existing design system, brand assets and presentation authorities instead of creating parallel UI patterns.

## Quality and release discipline

- Inspect the current repository and production state before changing behavior.
- Run the complete applicable quality gate, including focused regressions and repository-wide checks required by the affected area.
- Keep unrelated changes out of the branch.
- Merge only the exact commit that was tested and passed required CI.
- Monitor Render’s automatic deployment through completion and verify the deployed commit.
- Verify production behavior after deployment, including health, critical preserved paths and the requested outcome.
- If an infrastructure prerequisite is incomplete, stage the application change safely and do not deploy behavior that would create an outage.
