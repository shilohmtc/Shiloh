const express = require("express");
const auditReadAuth = require("../middleware/auditReadAuth");
const { getPostCanonicalizationAudit } = require("../services/canonicalizationAudit");
const { getCatalogueParityAudit } = require("../services/catalogueParityAudit");
const { getGoldieExitAudit } = require("../services/goldieExitAudit");
const { getReportingIntegrityAudit } = require("../services/reportingIntegrityAudit");
const { getBirthdayTemplateStatus, TEMPLATE_BODY } = require("../services/birthdayTemplateProvisioning");
const { inspectMetaTemplateInventory } = require("../services/metaTemplateContracts");
const { getClientWelcomeDiagnostic } = require("../services/clientWelcomeDiagnostic");
const { getAppointmentReadDiagnostic } = require("../services/appointmentReadDiagnostic");

const router = express.Router();

router.get("/canonicalization/status", async (req, res) => {
  try {
    const report = await getPostCanonicalizationAudit(req.query.batchId || null);
    return res.status(200).json({ status: { safety: report.safety, batchId: report.batchId, overallPass: report.overallPass, checks: report.checks }, requestId: req.id });
  } catch (error) {
    (req.log || console).error?.({ err: error }, "Failed to build sanitized canonicalization audit status");
    if (/batchId is required/.test(error.message || "")) return res.status(400).json({ error: error.message, requestId: req.id });
    return res.status(500).json({ error: "Could not build canonicalization audit status", requestId: req.id });
  }
});

router.get("/catalogue/status", async (req, res) => {
  try {
    const report = await getCatalogueParityAudit();
    return res.status(200).json({ report, requestId: req.id });
  } catch (error) {
    (req.log || console).error?.({ err: error }, "Failed to build catalogue parity audit");
    return res.status(500).json({ error: "Could not build catalogue parity audit", requestId: req.id });
  }
});

// Sanitized, read-only Goldie cutover gate. No client identity/contact data or external keys are returned.
router.get("/goldie-exit/status", async (req, res) => {
  try {
    const report = await getGoldieExitAudit();
    return res.status(200).json({ report, requestId: req.id });
  } catch (error) {
    (req.log || console).error?.({ err: error }, "Failed to build Goldie exit audit");
    return res.status(500).json({ error: "Could not build Goldie exit audit", requestId: req.id });
  }
});

// Sanitized, read-only reporting integrity. Returns only clean/dirty and counts;
// never client identity, appointment detail, legacy source value or earnings amounts.
router.get("/reporting-integrity/status", async (req, res) => {
  try {
    const report = await getReportingIntegrityAudit();
    return res.status(200).json({ report, requestId: req.id });
  } catch (error) {
    (req.log || console).error?.({ err: error }, "Failed to build sanitized reporting integrity audit");
    return res.status(500).json({ error: "Could not build reporting integrity audit", requestId: req.id });
  }
});

// Sanitized, authenticated, read-only client welcome state. Full phone, client IDs/names and contact data are omitted.
router.get("/client-welcome/status", auditReadAuth, async (req, res) => {
  try {
    const status = await getClientWelcomeDiagnostic(req.query.phone || "");
    return res.status(200).json({ status, requestId: req.id });
  } catch (error) {
    if (error.code === "INVALID_PHONE") {
      return res.status(400).json({ error: error.message, requestId: req.id });
    }
    (req.log || console).error?.({ err: error }, "Client welcome diagnostic failed");
    return res.status(500).json({ error: "Could not inspect client welcome state", requestId: req.id });
  }
});

// Sanitized, authenticated, read-only appointment lifecycle evidence. No client identity,
// contact data, provider IDs, message bodies or arbitrary SQL are returned.
router.get("/appointment/:appointmentId/status", auditReadAuth, async (req, res) => {
  try {
    const report = await getAppointmentReadDiagnostic(req.params.appointmentId);
    return res.status(200).json({ report, requestId: req.id });
  } catch (error) {
    if (error.code === "INVALID_APPOINTMENT_ID") {
      return res.status(400).json({ error: error.message, requestId: req.id });
    }
    (req.log || console).error?.({ err: error }, "Appointment read diagnostic failed");
    return res.status(500).json({ error: "Could not inspect appointment status", requestId: req.id });
  }
});

// Sanitized, read-only Meta template status. Provider/account IDs and credentials are intentionally not returned.
router.get("/birthday-template/status", async (req, res) => {
  try {
    const provider = await getBirthdayTemplateStatus();
    const currentBrand = "Shiloh Massage Therapy and Aesthetic Clinic";
    const submittedCopyUsesCurrentBrand = TEMPLATE_BODY.includes(currentBrand);
    return res.status(200).json({
      status: {
        ok: provider.ok === true,
        templateName: provider.templateName || null,
        configuredTemplateName: provider.configuredTemplateName || null,
        providerStatus: provider.template?.status || null,
        category: provider.template?.category || null,
        language: provider.template?.language || null,
        exists: Boolean(provider.template),
        submittedCopyUsesCurrentBrand,
        safeToEnable: provider.template?.status === "APPROVED" && submittedCopyUsesCurrentBrand,
        legacyTemplateName: provider.legacyTemplateName || null,
        legacyProviderStatus: provider.legacyTemplate?.status || null,
      },
      requestId: req.id,
    });
  } catch (error) {
    (req.log || console).error?.({ err: error }, "Failed to inspect sanitized birthday template status");
    return res.status(502).json({ error: "Could not inspect birthday template status", requestId: req.id });
  }
});


// Sanitized, paginated, read-only inventory. WABA IDs, tokens, phone numbers and provider IDs are omitted.
router.get("/meta-templates/status", auditReadAuth, async (req, res) => {
  try {
    const report = await inspectMetaTemplateInventory();
    return res.status(report.ok ? 200 : 503).json({ report, requestId: req.id });
  } catch (error) {
    (req.log || console).error?.({ err: error }, "Meta template inventory failed");
    return res.status(502).json({ error: "Could not inspect Meta template inventory", requestId: req.id });
  }
});

router.get("/canonicalization", auditReadAuth, async (req, res) => {
  try {
    const report = await getPostCanonicalizationAudit(req.query.batchId || null);
    return res.status(200).json({ report, requestId: req.id });
  } catch (error) {
    (req.log || console).error?.({ err: error }, "Failed to build canonicalization audit");
    if (/batchId is required/.test(error.message || "")) return res.status(400).json({ error: error.message, requestId: req.id });
    return res.status(500).json({ error: "Could not build canonicalization audit", requestId: req.id });
  }
});

module.exports = router;
