const TEMPLATE_NAME = 'shiloh_problem_report_resolved_v1';
const TEMPLATE_LANGUAGE = 'en';
const TEMPLATE_CATEGORY = 'UTILITY';
const TEMPLATE_BODY = `Hi {{1}}, your Shiloh problem report {{2}} has been resolved. ✅\n\nUpdate: {{3}}\n\nIf the problem continues, reply “Still not working {{2}}” and we’ll reopen it. 🌿`;

function buildProblemReportResolvedTemplateDefinition() {
  return {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [{
      type: 'BODY',
      text: TEMPLATE_BODY,
      example: { body_text: [['Miranda', 'SH-260920-AABBCCDD', 'The reminder now shows the confirmed time.']] },
    }],
  };
}

// Historical message definition only; no provider submission authority.
module.exports = { TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_BODY, buildProblemReportResolvedTemplateDefinition };
