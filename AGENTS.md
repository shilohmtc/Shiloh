# Shiloh repository instructions

These instructions apply to the entire repository.

## Working mode and communication

- Treat Shiloh as one living clinic platform, not a collection of unrelated features.
- At the start of each request, advise whether normal Chat or Work is appropriate.
- Keep client-facing language warm, simple and non-technical.
- State assumptions, blockers and release risk plainly. Never imply that an action was completed without direct evidence.

## Idea review and durable decisions

- When Christel puts forward an idea, pause before implementation and give a candid assessment: what problem it solves, how it fits Shiloh's direction, likely benefits, risks or tradeoffs, dependencies, and the next sensible step. Treat this as a request for thoughtful judgment, not automatic approval.
- Once Christel accepts a direction or standard, record the durable decision in the appropriate repository instruction, GitHub roadmap/issue, or canonical project document. Do not rely on chat memory alone for project behavior.
- Keep one authoritative record for each decision. Update an existing roadmap or instruction when one exists instead of creating a parallel list.
- Distinguish an idea under discussion, an accepted standard, an implemented change, production verification, and owner acceptance. Do not present a proposal as completed work.

Use [`docs/SHILOH_PLATFORM_HANDBOOK.md`](docs/SHILOH_PLATFORM_HANDBOOK.md) as the quick orientation map for the platform, its integrations, source-of-truth boundaries and operating links. Keep detailed behavior in the existing canonical code, migrations and documents linked from that handbook.

## Computer Use and connected tools

- For authenticated websites or desktop applications, first check whether **Computer Use → Any App** is attached to the current session.
- “Any App” refers specifically to ChatGPT’s computer-control feature, not any generic available application.
- When attached, prefer Christel’s existing signed-in local Google Chrome session instead of opening a separate cloud browser or requesting another login.
- If Any App is enabled but not attached, explain that immediately. Do not start or repeat cloud-browser sign-in flows unless Christel explicitly requests them.
- Prefer the connected GitHub and Render tools for operations they support. Use Any App when an authenticated dashboard action is required and the connector does not expose it.
- Never request passwords, one-time codes or other credentials in chat.

## Publishing changes through connected GitHub

Use Shiloh's connected GitHub integration as the default publishing path. Do not attempt to authenticate a local `git push` from the workspace, ask for Git credentials, or route around an approval rejection. The user's authorization to publish must be established before writing to GitHub.

1. Fetch current `main`, work on a dedicated local branch, review the diff, and run the applicable local checks. Keep generated artifacts and secrets out of the commit.
2. Create the same dedicated branch through the connected GitHub integration from the exact `main` SHA used locally. Upload only changed file blobs. Compare each returned blob SHA with `git ls-tree` for the local commit.
3. Create a tree from the base tree plus those changed blobs. Its SHA must match the local commit's `git rev-parse HEAD^{tree}`. If it differs, stop and inspect the full path/mode/content set before publishing.
4. Create one connected GitHub commit with that verified tree and the exact base commit as parent; advance only the dedicated branch ref. The GitHub commit SHA can differ from the local SHA because author and committer metadata differ, but the tree must match. Open a PR against `main`.
5. Run and inspect every applicable exact-head workflow, including Storybook, phone/desktop Playwright, accessibility, visual artifacts, focused regressions, and CI for interface changes. Repair actual failures; rerun an unchanged head only for an evidenced transient runner failure. Never weaken a check to obtain a merge.
6. Immediately before merging, recheck the PR head and base, then merge with `expected_head_sha` set to the tested GitHub head. Follow Render's automatic deploy, migration authority, health, and production behavior checks. Record the exact deployed merge SHA and any remaining human acceptance on the existing roadmap.

For a small documentation-only change, apply the same branch, tree, PR, exact-head, and release evidence steps with the applicable documentation checks. Do not claim that a green build proves an authenticated client journey or a live payment.

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
