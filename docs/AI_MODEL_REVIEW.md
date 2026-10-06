# Shiloh AI model review

Shiloh's active client assistant is inside My Shiloh and uses `src/services/ai.js` through the OpenAI Responses API. Automated WhatsApp conversations are retired; the human Message Reception link remains separate. The runtime variables `OPENAI_MODEL` and `OPENAI_FAST_MODEL` override the code defaults; the production values must be checked privately in Render before declaring a model live. Never put API keys or client messages in a review issue.

## Current intended choice — 28 September 2026

| Workload | Model | Reason |
| --- | --- | --- |
| Client conversation and read tools | `gpt-6-sol` | Preserve judgment for booking, policy, price and human handoff. |
| Fast, scoped classification | `gpt-6-luna` | Lower cost for narrow classification work. |

Standard short-context text rates at this review: Sol $2 input / $10 output; Luna $0.10 input / $0.50 output per million tokens. These are review notes, not a billing authority. Check the [official model catalog](https://developers.openai.com/api/docs/models), [pricing](https://developers.openai.com/api/docs/pricing) and [model guidance](https://developers.openai.com/api/docs/guides/latest-model) for current rates and availability.

## Monthly decision

The scheduled GitHub workflow opens one review issue each month. An authorized maintainer:

1. Checks the actual production model names and the last month's privacy-safe `OpenAI usage` logs or OpenAI project usage dashboard. Compare total cost, response latency and error rate, not just token prices. Do not copy client text or credentials into the issue.
2. Checks official OpenAI model documentation, current pricing and deprecations for the two workloads. Record the page links and review date. An announced model is a candidate, not an automatic production switch.
3. Runs Shiloh's representative assistant evaluation and regression cases: ordinary FAQ; typo and unsupported policy; canonical current price and availability; flexible/group request; Reception handoff; failed tool; English language classification. Review a small set of real-device conversations without sharing client data.
4. If the candidate improves measured cost or quality without breaking the above, open a bounded PR, run the exact-head checks, and confirm the Render production override and deployed model. Preserve the previous two model IDs as a rollback option until the new choice is verified.
5. Close the monthly issue with `keep` or `change`, the evidence and the next review month. If the production override differs from source, reconcile it explicitly.

The monthly workflow is a reminder and decision record. It does not call OpenAI, change a model, alter a client conversation or claim to know new model prices automatically.

## GPT-6.1 Sol comparison — accepted first step, 6 October 2026

Evaluate `gpt-6.1-sol` against the existing `gpt-6-sol` conversation default before deciding on a switch. Keep `gpt-6-luna` unchanged. Current official references: [Sol 6.1](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Sol 6](https://developers.openai.com/api/docs/models/gpt-6-sol), and [pricing](https://developers.openai.com/api/docs/pricing). Both conversation models publish standard short-context rates of $2 input and $10 output per million tokens; cached input, cache writes, reasoning consumption and actual request counts can change the total. The first live results below do not establish an overall production benefit or lower monthly bill.

Run from a checkout of the exact reviewed revision:

```sh
npm ci
node --test tests/assistant-model-review.test.js
npm run ai:review:preflight
# Only in an authorized environment with OPENAI_API_KEY securely provided:
npm run ai:review:live
```

Preflight requires no key, network call or database. Live mode makes billable OpenAI calls, with SDK retries disabled and a 45-second request timeout. Twelve cases across two fixed models have at most four requests per case and 1,600 output tokens per request (including reasoning). Provider errors stop the remaining comparison. `artifacts/assistant-model-review/latest.json` is ignored by Git; it contains synthetic replies, tool traces, token counts, latency, screening and pending human review. Dry runs contain no model results and are never performance evidence. The runner does not load `.env`; environment credentials must be supplied by the authorized execution environment, never pasted into chat or GitHub.

The runner reuses the production `buildInstructions` for My Shiloh and tool-schema snapshots checked against current exports. It never imports production tool executors, reads client records, creates sessions, queries the database, contacts Reception, or changes bookings/payments. All service facts and tool results in this pack are synthetic; ZAR 590, ZAR 295 and the October appointment are test values, not claims about current clinic prices or availability.

Coverage: canonical price/duration, typos, unsupported policies, payment truth versus user claims, exact practitioner/date availability, unavailable tools, cancellation preparation, flexible/group planning, direct human Reception, English-only replies, off-topic requests and prompt injection. Regex and tool-use screening is only a first pass: inspect every answer for factual correctness, warmth, concise wording, SAST time interpretation and absence of false action claims. Record human pass/fail and reasons separately in the monthly review. Repeat borderline cases before selecting a model.

This is an isolated model/prompt/tool comparison, not an end-to-end production evaluation: production deterministic FAQ shortcuts, persistent `previous_response_id` continuity, authentication and client UI confirmations are excluded. Live evaluation uses `store:false` and explicitly carries ephemeral conversation output between synthetic tool rounds. Existing FAQ, privacy and My Shiloh integration regressions plus real-device review remain required before a switch. The retired WhatsApp English-language classifier is not being upgraded in this phase.

Any model switch remains **pending broader comparison and owner review**. Verify the actual Render model overrides and baseline usage privately, compare each model's quality, total tokens, errors and latency, and retain the old model IDs for rollback. A green offline test or regex screen must never trigger a production model switch. The private staff connection is the proposed next phase; its authentication and record scopes require separate design before implementation.

### First live comparison — 6 October 2026

The authorized My Workspace Render Shell run used a temporary checkout of PR #1392 revision `22aa15599fab005bb498bd01befa6418aeb2d9e0`, reusing the installed SDK without exposing credentials. Production was revision `eb4457088dc3b1acab561439d52e33c2766cb005`, deployed live as `dep-db2d2no473hc739eqlq0`. Effective runtime model IDs were `gpt-6-sol` and `gpt-6-luna`, with `low` reasoning. The comparison performed 34 billable API requests across 24 synthetic answers; it did not change production configuration or use client records.

| Measurement | GPT-6 Sol | GPT-6.1 Sol |
| --- | --- | --- |
| Synthetic cases | 12 | 12 |
| Original automatic screening | 11/12 | 11/12 |
| Screening after correcting the negation false positive, on the same answers | 11/12 | 12/12 |
| Total input tokens | 38,850 | 38,850 |
| Cached input tokens (included in input total) | 26,853 | 26,853 |
| Total output tokens (including reasoning) | 675 | 681 |
| Total elapsed time across cases | 31.284 seconds | 79.443 seconds |
| Mean elapsed time per case, including tool rounds | 2.607 seconds | 6.620 seconds |
| API/incomplete-response errors | 0 | 0 |

The Sol availability answer returned the exact slot as **12:00–13:00 UTC**, rather than the expected **14:00–15:00 SAST**. It kept Abigail, the date and the read-only booking boundary correct. Sol 6.1 returned **2:00 pm local clinic time**. Its cancellation answer correctly said **“No appointment has been cancelled yet”**, but the original regex matched the negated phrase. The screening rule and a regression case now preserve that explicit negation. No new API requests were needed to re-screen the recorded answers.

All 24 answers were inspected by Codex. Both models preserved canonical payment truth, required UI confirmation for cancellation, separated Reception contact from message delivery, deferred unknown policy and rejected off-topic/prompt-injection requests. Sol 6.1's failed-availability reply exposed the wording “availability tool”, which should be reviewed for client-facing simplicity. This inspection is assistant review, not owner acceptance or a real-device production test; raw reports retain `humanReview: pending`.

**Recommendation: keep the existing production model pending a broader review.** In this single small run, Sol 6.1 was approximately 2.54 times slower with similar token consumption. It improved local-time presentation, but this alone does not establish an overall production benefit. A separate change should make local clinic timezone presentation explicit for both models and check SAST formatting at the application boundary. Repeat representative multi-turn cases and obtain owner acceptance before considering a switch. Production usage/billing history was not compared, and these measurements do not establish monthly cost or reliable production latency. The next proposed integration remains a private staff connection with existing authentication and record scopes; no staff plugin has been created by this change.
