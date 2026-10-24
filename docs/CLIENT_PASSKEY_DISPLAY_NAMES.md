# Client passkey display names

Owner-approved, 24 October 2026: newly saved My Shiloh passkeys use a friendly
label combining the client's first name and broad detected device type, such
as “Jean-Pierre’s Android”. Reuse Workspace's possessive-name and length rules.

Use the recorded first name, or the first word of the recorded display name
when it is missing. Missing names keep the generic device label. Unknown
devices use “Shiloh device”; an overlong combined label falls back to device type.

Names are plain text. Existing passkeys are not renamed or backfilled, and
Rename stays available. The label is not proof of a specific phone, exact
model, password manager or physical device: synced passkeys can span devices.
This change does not alter credentials, verification or sign-in policy.
