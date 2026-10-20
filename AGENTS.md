# Shiloh repository instructions

These instructions apply to the entire repository.

## Working mode and communication

- Treat Shiloh as one living clinic platform, not a collection of unrelated features.
- At the start of each request, advise whether normal Chat or Work is appropriate.
- Keep client-facing language warm, simple and non-technical.
- Client-facing authentication, support and generic welcome copy refers to Reception or the Shiloh team, never individual staff names. Preserve actual client/practitioner names in records, booking choices and staff-only content.
- State assumptions, blockers and release risk plainly. Never imply that an action was completed without direct evidence.
- Minimise approval interruptions. Batch related routine checks, reuse already granted permissions where the platform supports them, and carry an authorised task through without asking again at each step. Explain the specific platform or repository requirement when an approval is unavoidable. Never bypass a denied approval or claim to have disabled platform controls.

## Idea review and durable decisions

- When Christel puts forward an idea, pause before implementation and give a candid assessment: what problem it solves, how it fits Shiloh's direction, likely benefits, risks or tradeoffs, dependencies, and the next sensible step. Treat this as a request for thoughtful judgment, not automatic approval.
- Once Christel accepts a direction or standard, record the durable decision in the appropriate repository instruction, GitHub roadmap/issue, or canonical project document. Do not rely on chat memory alone for project behavior.
- Keep one authoritative record for each decision. Update an existing roadmap or instruction when one exists instead of creating a parallel list.
- Distinguish an idea under discussion, an accepted standard, an implemented change, production verification, and owner acceptance. Do not present a proposal as completed work.

Use [`docs/SHILOH_PLATFORM_HANDBOOK.md`](docs/SHILOH_PLATFORM_HANDBOOK.md) as the quick orientation map for the platform, its integrations, source-of-truth boundaries and operating links. Keep detailed behavior in the existing canonical code, migrations and documents linked from that handbook.

## Connected tools and secure browser

- Use the existing connected GitHub and Render tools first for Shiloh implementation work.
- When authenticated browser access is needed, use ChatGPT's secure browser and let Christel sign into GitHub or Render there. Reuse available signed-in sessions.
- Do not require or check for Computer Use → Any App.
- Never request passwords, one-time codes or other credentials in chat.

## Publishing changes through connected GitHub

Use Shiloh's connected GitHub integration as the default publishing path. Do not attempt to authenticate a local `git push` from the workspace, ask for Git credentials, or route around an approval rejection.

Assess authorisation from the user's task and existing session approvals, rather than asking at every release step. A request to build, implement or fix a Shiloh feature authorises ordinary local changes, relevant checks, a dedicated connected GitHub branch and a draft PR for that task. A request to publish, release, deploy or make that change live authorises the necessary PR, passing exact-head checks, merge, controlled migration and deployment verification within the agreed scope. Carry that authorisation forward across retries and follow-ups. Ask only when the next action materially exceeds the agreed scope or a platform control specifically requires approval. A status question alone does not authorise deployment. Existing quality, migration, production and business-authority safeguards still apply.

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


## Accepted client entry and passkey experience — 20 October 2026

- My Shiloh uses one WhatsApp entry: verify the recorded number, then open its unique active canonical profile or collect a genuinely new client's registration details. An earlier phone-verification flag is not a prerequisite. Do not merge profiles or open historical records by guessing ownership.
- Client sign-in and number changes are self-service; do not route them through Reception approval. Existing passkeys and signed-in Profile remain alternatives when a number changes. An unrelated new number alone does not identify an old profile.
- Successful client and staff entry opens the app directly; former welcome URLs are authenticated redirects. Use an optional in-app card for notifications first, then passkey setup in My Shiloh and Workspace; preserve Not now and remembered choices.
- Public sign-in offers existing passkeys; creating one belongs in the signed-in account. Profile must allow adding another key when one already exists. A remembered Workspace key identifies an account, not an exclusive password manager; offer its other active keys while retaining account binding.
- After own-account WhatsApp verification (including a fresh staff sign-in), passkey setup stays available for a fixed ten minutes for retries or reopening in that same browser/session. Do not extend that window on retry or reuse a completed native challenge. Replacement safeguards remain separate.
- Synthetic proof and physical-device Google/Samsung acceptance are different milestones. Do not claim device compatibility solely from a mocked credential ceremony.
