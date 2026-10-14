// Compatibility export for startup patches and older internal callers.
// Automated staff WhatsApp routing is retired. The legacy
// assistant must never advertise or execute Calendar/CRM mutation commands.
async function processAdminAssistantMessage() {
  return { handled: false, retired: true };
}

module.exports = { processAdminAssistantMessage };
