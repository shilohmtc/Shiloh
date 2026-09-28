# Shiloh AI model review

Shiloh's WhatsApp and My Shiloh conversations use `src/services/ai.js` through the OpenAI Responses API. The English language guard uses the lighter model. The runtime variables `OPENAI_MODEL` and `OPENAI_FAST_MODEL` override the code defaults; the production values must be checked privately in Render before declaring a model live. Never put API keys or client messages in a review issue.

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
