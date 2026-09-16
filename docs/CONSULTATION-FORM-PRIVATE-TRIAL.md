# Private consultation form trial

This is an explicitly authorized single-person test, not activation of real client form delivery.

## Isolation

The trial reads the published Swedish or Hot Stone questionnaire and reuses the production form renderer, validation and encryption helpers. Only `consultation_form_trials` is written. No client, appointment, assignment, calendar, payment, practitioner-note or WhatsApp delivery record is created. The page is clearly labelled TEST FORM and prefilled only with fictional details. The typed name should be `Test Client`.

The rendered questionnaire and consent are pinned at first open. Answers and the typed signature are encrypted before persistence. Each submission is read back and decrypted inside its transaction; a failed round-trip rolls back rather than claiming success. Only a completion receipt, never stored answers, can be reopened. A token accepts one completed submission; subsequent submits cannot overwrite it.

## Controlled activation

Apply migration `133_private_consultation_form_trials.sql` after migration 132, using the existing controlled single-migration release mechanism. Remove the migration authority after verification.

Configure these only in Render, never in source code, PR comments, artifacts or logs:

- `SHILOH_CONSULTATION_FORM_TRIAL_ENABLED=true`
- `CONSULTATION_FORM_TRIAL_ACCESS_HASH`: SHA-256 hex hash of one cryptographically random 32-byte base64url token
- `CONSULTATION_FORM_TRIAL_EXPIRES_AT`: fixed ISO expiry, normally 48 hours, at most 72 hours ahead
- `CONSULTATION_FORM_TRIAL_TEMPLATE`: `hot_stone_massage_consultation` (default) or `swedish_massage_consultation`
- `CONSULTATION_FORM_DATA_KEY`: the stable private 32-byte base64url encryption key; never replace a key used by existing submissions

Keep `SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED=false` and automatic delivery off during this test. The trial has its own activation flag and never calls a messaging provider.

Give the owner the complete `https://app.shilohmtc.co.za/forms/test#<token>` link privately. The fragment is removed from browser history and exchanged in a same-origin POST body. It is not placed in HTTP request URLs, referrers, source control, client-side storage or application logs. The generic landing page contains no questionnaire or client details. Missing/foreign origins, unsupported content types, extra fields and oversized bodies are rejected. All form paths are redacted in the application request logger.

## Verification and cleanup

At activation the service performs a synthetic encrypted database round-trip in the isolated trial table and rolls it back. It logs only the event `consultation_form_trial_ready` and non-sensitive verification flags. This does not consume the owner's test link. Failure keeps the test unavailable without stopping the rest of Shiloh.

Node tests cover the private HTTP flow, access expiry, flag revocation, validation, ciphertext tampering, rollback and replay. The dedicated browser workflow uses the actual route and current questionnaire with a synthetic database, proving mobile and desktop interaction. This is distinct from the production startup database check.

The link expires at the configured absolute time; restarting cannot extend it. Expired trial rows are purged at startup and hourly while trial mode is enabled. If the service is stopped, deletion waits for its next enabled start. To revoke access immediately, set the trial flag false. A new tester needs a new random token/hash; do not forward a real appointment's consultation link to a tester.
