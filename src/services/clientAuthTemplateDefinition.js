const {
  buildStaffAuthTemplateSubmissionDefinition,
} = require('./staffAuthTemplateDefinition');

const CLIENT_AUTH_TEMPLATE_NAME = 'shiloh_client_auth_otp_v1';
const CLIENT_AUTH_TEMPLATE_LANGUAGE = 'en_US';

function buildClientAuthTemplateSubmissionDefinition() {
  return {
    ...buildStaffAuthTemplateSubmissionDefinition(),
    name: CLIENT_AUTH_TEMPLATE_NAME,
  };
}

module.exports = {
  CLIENT_AUTH_TEMPLATE_NAME,
  CLIENT_AUTH_TEMPLATE_LANGUAGE,
  buildClientAuthTemplateSubmissionDefinition,
};
