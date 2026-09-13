# Provider-independent staff authentication continuity

Status: retired by owner authorization in #952.

Shiloh Workspace authentication now uses canonical passkeys, ordinary hashed server-side browser sessions, and private one-use setup links issued through the existing Shiloh WhatsApp conversation. “Add this device” preserves other passkeys. “Replace a lost device” registers the new passkey before revoking prior passkeys and active browser sessions.

The former TOTP, recovery-code, and controlled break-glass application paths are no longer mounted or referenced by runtime code. Their historical database tables and audit records remain inert so this retirement does not require destructive schema work. The four former TOTP environment variables may be deleted only after the #952 exact head is live and the passkey and WhatsApp setup paths pass post-deploy proof.

If a future independent recovery factor is needed, it must be designed as a new bounded security unit against the canonical `staff_admin_accounts` authority. Historical TOTP credentials must not be silently reactivated.
