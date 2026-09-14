# Shiloh Engineering Fast Path

Status: **Permanent engineering execution guidance under Shiloh operating rules**

This document is not a second governance or release authority. `docs/SHILOH_OPERATING_RULES.md` and GitHub issue #611 remain authoritative. The Fast Path exists only to reduce avoidable engineering latency while preserving the same release safety.

## 1. Pre-CI contract impact scan

Before the first full CI candidate for a bounded change, inspect the direct consumers of every changed contract.

Treat these as contracts when changed: route/path, request body, response shape, service method signature/options, canonical datastore field semantics, capability/scope boundary, environment flag, DOM selector/data attribute used by browser proof, or proof artifact contract.

For each changed contract:

1. search the repository for the exact route, symbol, field or selector;
2. inspect direct consumers in `tests/`, `scripts/`, stubs and adjacent service/route code;
3. update affected assertions/stubs/proofs in the same candidate without weakening their original security or authority invariant;
4. run the smallest focused consumer test/proof available;
5. only then send the exact branch head to full CI.

If no contract changed, record that the impact scan is not applicable. Do not invent a generic dependency graph or static-analysis framework for this purpose.

## 2. Coherent multi-file changes

A bounded conceptual change that naturally spans several files should normally land as one coherent branch commit or a small number of conceptual commits, not as a connector-driven one-file commit chain.

Use ordinary local Git where available, or GitHub tree/commit primitives when working through connectors. Preserve reviewability: one conceptual candidate per commit, no unrelated cleanup, and no giant mixed-purpose commit merely to reduce commit count.

Focused debugging commits are acceptable after CI exposes a concrete defect, but consolidate only when doing so does not obscure evidence that matters.

## 3. CI parallelism rule

Release-required checks may execute in parallel only when their state is independent. Parallel jobs must not share mutable production/provider state, credentials, retained database mutations, fixed external resources, or an artifact path that can collide on the same runner.

The V1 audit found the post-regression Calendar and Workspace browser/visual proof families suitable for separate GitHub-hosted jobs because each job receives an isolated runner, the inspected browser proofs use synthetic/local fixtures and ephemeral local ports or file rendering, and artifact names/paths are distinct. All checks remain mandatory; no job uses `continue-on-error` and no release gate is removed.

If a future proof gains shared external or mutable state, serialize it again rather than preserving parallelism for speed.

## 4. Verification cadence

Use focused tests/proofs as the development feedback loop. Use full exact-head CI as the release gate, not as the primary discovery mechanism.

When full CI fails, diagnose the exact failed gate, run/update its focused consumer where practical, then produce a new exact-head candidate. Do not repeatedly rerun the whole pipeline to discover a chain of predictable stale assertions.

## V1 baseline and expected gain

Baseline evidence: successful CI run #1964 used one sequential job from approximately 12:16:19 to 12:18:32 (about 133 seconds). The post-regression browser/visual tail consumed roughly 83 seconds serially. Splitting that tail into isolated Calendar and Workspace proof jobs keeps every check mandatory while reducing the expected critical path to roughly 50–70 seconds plus runner scheduling/cache variance.

This is an engineering-throughput optimization only. It changes no Shiloh clinic/product/runtime behavior.
