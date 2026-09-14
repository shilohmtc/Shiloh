require("dotenv").config();
const path = require("path");
const express = require("express");
const { createPaymentProviderRouter } = require('./src/routes/paymentProviders');
const { validateEnv } = require("./src/config/env");
const logger = require("./src/lib/logger");
const observability = require("./src/lib/observability");
const requestContext = require("./src/middleware/requestContext");
const { securityHeaders } = require("./src/middleware/securityHeaders");
const { canonicalHostRedirect } = require("./src/middleware/canonicalHostRedirect");
const { presentClientFamilyResult } = require("./src/presentation/clientFamilyPresentation");
const { presentClientAppointmentChangeResult } = require("./src/presentation/clientAppointmentChangePresentation");
const { presentCustomerExperienceResult } = require("./src/presentation/customerExperiencePresentation");
const clientFamilyService = require("./src/services/clientServiceFamilyDiscovery");
const appointmentChangeService = require("./src/services/appointmentChange");
const { decorateAppointmentChangeTemplate } = require("./src/services/appointmentChangeTemplateDelivery");
const customerExperienceService = require("./src/services/customerExperience");
const clientIdentityService = require("./src/services/clientIdentityOnboarding");
const clientDiscoveryService = require("./src/services/clientDiscoveryMenu");
const { installClientNavigationPriority } = require("./src/services/clientNavigationPriority");
const { submitWorkspaceBookingRequestAlertTemplate } = require("./src/services/workspaceBookingRequestAlertTemplateProvisioning");

observability.initialize();
validateEnv();
const processClientServiceFamilyMessage = clientFamilyService.processClientServiceFamilyMessage;
clientFamilyService.processClientServiceFamilyMessage = async (...args) => presentClientFamilyResult(await processClientServiceFamilyMessage(...args));
const processAppointmentChangeMessage = appointmentChangeService.processAppointmentChangeMessage;
appointmentChangeService.processAppointmentChangeMessage = async (phone, text, ...rest) => {
  const priorIntent = await appointmentChangeService.getIntent(phone);
  const result = await processAppointmentChangeMessage(phone, text, ...rest);
  const templated = await decorateAppointmentChangeTemplate(phone, priorIntent, result);
  return presentClientAppointmentChangeResult(templated);
};
const processCustomerExperienceMessage = customerExperienceService.processCustomerExperienceMessage;
customerExperienceService.processCustomerExperienceMessage = async (...args) => presentCustomerExperienceResult(await processCustomerExperienceMessage(...args));
installClientNavigationPriority({ identityService: clientIdentityService, discoveryService: clientDiscoveryService });

const webhookRoutes = require("./src/routes/webhook");
const adminRoutes = require("./src/routes/admin");
const auditReadRoutes = require("./src/routes/auditRead");
const calendarRoutes = require("./src/routes/calendar");
const walkinRoutes = require("./src/routes/walkin");
const bookRoutes = require("./src/routes/book");
const publicWebsiteRoutes = require("./src/routes/publicWebsite");
const serviceRoutes = require("./src/routes/services");
const { checkDatabase, startConversationSessionCleanupScheduler } = require("./src/services/memory");
const { startTemporarySessionCleanupScheduler } = require("./src/services/temporarySessionRetention");
const { startGoogleBusinessProfileSyncScheduler } = require("./src/services/googleBusinessProfileSync");
const { startAppointmentLifecycleScheduler } = require("./src/services/appointmentLifecycle");
const { startCustomerCareScheduler } = require("./src/services/customerCare");
const { startBookingIntegrityScheduler } = require("./src/services/bookingIntegrityMonitor");
const { startMandatoryDemoCleanupScheduler } = require("./src/services/demoMandatoryCleanup");
const { startAttendanceFinalizationReminderScheduler } = require("./src/services/attendanceFinalizationReminders");
const { startHistoricalFinalizationPromptScheduler } = require("./src/services/historicalFinalizationPrompt");
const { runConfiguredClientProvenanceAudit } = require("./src/services/clientProvenanceAudit");
const { runCalendarAccessDiagnostic } = require("./src/services/calendarAccessDiagnostic");
const { verifyMigrationState } = require("./src/services/migrations");
const {
  ensureDeliveryTable: ensureBookingConfirmationDeliverySchema,
  startCustomerBookingConfirmationScheduler,
} = require("./src/services/customerBookingConfirmation");

const app = express();
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(canonicalHostRedirect);
app.use(express.json({ limit: "2mb" }));
app.use(requestContext);
app.use("/assets/service-images", express.static(path.join(__dirname, "public", "service-images"), { maxAge: "30d", immutable: true }));
app.get("/health", async (req, res) => { const ok = await checkDatabase(); return res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", database: ok ? "ok" : "unavailable", timestamp: new Date().toISOString() }); });
app.use("/payments/providers", createPaymentProviderRouter()); app.use("/audit-read", auditReadRoutes); app.use("/admin", adminRoutes); app.use("/calendar", calendarRoutes); app.use("/", publicWebsiteRoutes); app.use("/", serviceRoutes); app.use("/", walkinRoutes); app.use("/", bookRoutes); app.use("/", webhookRoutes);
app.use((err, req, res, next) => {
  const log = req.log || logger;
  const route = `${req.baseUrl || ""}${req.route?.path || ""}` || "unmatched";
  observability.captureException(err, {
    "error.kind": "express",
    "error.code": err?.code,
    "http.method": req.method,
    "http.route": route,
  });
  log.error({ err }, "Unhandled Express error");
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: "Internal server error", requestId: req.id });
});

async function provisionWorkspaceBookingRequestAlertIfExplicitlyEnabled() {
  if (String(process.env.META_WORKSPACE_BOOKING_REQUEST_ALERT_PROVISION_ON_START || '').toLowerCase() !== 'true') return;
  try {
    const result = await submitWorkspaceBookingRequestAlertTemplate();
    logger.info({
      ok: result?.ok === true,
      templateName: result?.templateName || null,
      submitted: result?.submitted === true,
      reason: result?.reason || null,
      providerStatus: result?.provider?.status || result?.verification?.status || result?.template?.status || null,
      providerCategory: result?.provider?.category || result?.verification?.category || result?.template?.category || null,
      providerLanguage: result?.verification?.language || result?.template?.language || null,
      exact: result?.verification?.exact ?? result?.template?.exact ?? null,
      duplicateCount: result?.duplicateCount ?? null,
    }, "Workspace booking request alert provisioning checked");
  } catch (error) {
    logger.error({ err: error, metaError: error.response?.data?.error }, "Workspace booking request alert provisioning failed");
  }
}

const PORT = process.env.PORT || 3000; let server;
async function start() {
  const migrationAuthority = await verifyMigrationState();
  logger.info({ migrationFiles: migrationAuthority.migrationFiles, ledgerRows: migrationAuthority.ledgerRows, pending: migrationAuthority.pending.length, checksumMismatches: migrationAuthority.checksumMismatches.length, ledgerRowsAbsentFromRelease: migrationAuthority.ledgerRowsAbsentFromRelease.length, mutationAuthority: 'npm run db:migrate', startupMode: 'verify_only' }, "Production migration authority verified");
  try { const calendarAccess = await runCalendarAccessDiagnostic(); logger.info(calendarAccess, "Sanitized Calendar staff access diagnostic"); } catch (error) { logger.warn({ err: error }, "Sanitized Calendar staff access diagnostic failed"); }
  logger.info({ initialized: true, migrationAppliedNow: false, identityContractVersion: 'whatsapp_crm_identity_compat_v1', legacyCompatibility: true, crmV2RegistrationActive: true, registrationBoundary: 'crmV2ClientService.registerWhatsAppClient' }, "WhatsApp CRM V2 identity compatibility schema verified");
  await ensureBookingConfirmationDeliverySchema(); logger.info({ initialized: true, migrations: ['071_booking_confirmation_template_evidence.sql', '083_initial_booking_confirmation_guarantee.sql', '085_calendar_clean_crm_v2_cutover.sql'], migrationAppliedNow: false, checksumVerified: true, durableRetryColumns: true, crmV2RecipientSnapshots: true }, "Booking confirmation delivery evidence schema verified");
  try { await runConfiguredClientProvenanceAudit(logger); } catch (error) { logger.error({ err: error }, "Read-only CRM provenance audit failed"); }
  await provisionWorkspaceBookingRequestAlertIfExplicitlyEnabled();
  server = app.listen(PORT, () => { logger.info({ port: PORT }, "Shiloh started"); startConversationSessionCleanupScheduler(); startTemporarySessionCleanupScheduler(); startGoogleBusinessProfileSyncScheduler(); startAppointmentLifecycleScheduler(); startCustomerCareScheduler(); startBookingIntegrityScheduler(); startCustomerBookingConfirmationScheduler(); startMandatoryDemoCleanupScheduler(); startAttendanceFinalizationReminderScheduler(); startHistoricalFinalizationPromptScheduler(); });
}
start().catch(async (error) => {
  observability.captureException(error, { "error.kind": "startup", "error.code": error?.code, "runtime.phase": "startup" });
  await observability.flush();
  logger.fatal({ err: error }, "Shiloh failed during startup");
  process.exit(1);
});
function shutdown(signal) { logger.info({ signal }, "Shutting down Shiloh"); if (!server) return process.exit(0); server.close(() => { logger.info("HTTP server closed"); process.exit(0); }); setTimeout(() => { logger.error("Forced shutdown after timeout"); process.exit(1); }, 10000).unref(); }
process.on("SIGTERM", () => shutdown("SIGTERM")); process.on("SIGINT", () => shutdown("SIGINT"));
