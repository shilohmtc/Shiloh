# Shiloh UX visual + accessibility baselines

This gate protects a deliberately small set of deterministic, production-backed Storybook states. It is engineering-only verification; it does not create product or business authority.

## Protected reference states

- Desktop Calendar reference toolbar + practitioner/status presentation from `stories/CalendarReference.stories.js`.
- Phone 390x844 Calendar reference touch toolbar + appointment presentation from the same production-backed story module.
- Desktop and Phone Workspace Dashboard operational overview.
- Desktop and Phone client profile with clickable appointment history.
- Desktop and Phone Messages attention and recent-delivery evidence.
- Desktop and Phone compact appointment editor.

The stories import the released Shiloh UI primitives, Calendar reference adapter and Workspace presentation authorities from `src/presentation`; the gate must not introduce a parallel product implementation. The appointment-editor story executes the released compact-editor transformation against bounded sample form content.

## What CI checks

`UX Visual + Accessibility` builds Storybook, serves the static catalogue, and uses pinned Playwright Chromium to open the ten exact Desktop and Phone story iframe states. For each state it:

1. runs axe through `@axe-core/playwright` and fails on configured serious or critical WCAG 2.0/2.1 A/AA violations;
2. uses Playwright `toHaveScreenshot` comparison against the reviewed baseline;
3. uploads Playwright actual/diff/report artifacts when visual comparison fails.

Accessibility automation is a regression aid, not a substitute for human accessibility review.

## Baseline ownership and updates

Committed baseline authority is the reviewed `tests/ux-baselines/*.png.b64.part*` text fixture set. The parts are only a transport/storage representation of one exact PNG per reference state. `scripts/ux-baseline-codec.js` validates the numeric part sequence, optional alphabetic subparts, optional nested numeric segments, base64 syntax, PNG signature, and terminal IEND marker before reconstructing the pixels in validated semantic order. Missing, non-contiguous, malformed, mixed, truncated, or non-PNG fixtures fail closed.

The normal encoder emits deterministic bounded numeric parts. Smaller subparts/nested segments are permitted only as an equivalent transport representation when required by repository tooling; they do not change the reviewed PNG bytes.

Never auto-accept visual drift. If a visual change is intentional:

1. verify the underlying production-backed story changed for an authorized reason;
2. run the Storybook build and Playwright suite with `--update-snapshots` in the same Ubuntu/Chromium environment used by CI;
3. inspect the generated PNGs visually on both Desktop and Phone;
4. run `node scripts/ux-baseline-codec.js encode`, which replaces the prior parts with deterministic bounded parts;
5. commit only the approved `.png.b64.part*` fixtures together with the authorized presentation change;
6. rerun the exact-head UX gate and normal repository gates.

When a new baseline has not yet been committed, the PR workflow generates candidate PNGs plus their encoded part fixtures as an artifact and fails closed. A deliberate human visual review must accept the pixels and commit the corresponding parts before the gate can pass.

## Clean Change

- **Reuse:** existing Storybook production-backed stories, current browser-proof CI conventions, and the already-installed Storybook accessibility addon.
- **Smallest change:** one bounded Playwright config/test, one baseline codec, one isolated PR workflow, and reviewed baseline fixtures; no application renderer or product route changes.
- **Permanent artifacts:** the workflow, test/config, codec, documentation, and approved baseline fixture parts.
- **Temporary artifacts:** decoded PNGs, Playwright reports/diffs, and first-run baseline-candidate artifacts; none are committed as runtime authority.
- **Authority duplication:** none. This is verification only and owns no business rule, datastore, permission, provider, or product surface.
- **One-year test:** retain while Storybook remains the production-backed UX workshop; it provides low-cost regression detection without a paid visual-testing service.
- **Disposition:** COEXISTS FOR A REASON with existing authenticated browser proofs. Storybook baselines catch deterministic presentation drift; authenticated proofs continue to cover real route/session/mutation integration.
