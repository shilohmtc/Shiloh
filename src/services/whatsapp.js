const axios = require("axios");
const logger = require("../lib/logger");

function messagesUrl() {
  return `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`;
}

function requestConfig() {
  return {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  };
}

function triggerBookingCustomerConfirmation(message = "") {
  const match = String(message).match(/Booking created successfully\s*[—-]\s*appointment\s+#(\d+)/i);
  if (!match) return;
  const appointmentId = Number(match[1]);
  setImmediate(() => {
    const { sendCustomerBookingConfirmationForAppointment } = require('./customerBookingConfirmation');
    sendCustomerBookingConfirmationForAppointment(appointmentId).catch((error) => {
      logger.error({ err: error, appointmentId }, "Post-booking customer confirmation trigger failed");
    });
  });
}

async function sendWhatsAppMessage(to, message) {
  try {
    const response = await axios.post(
      messagesUrl(),
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      },
      requestConfig()
    );

    logger.info(
      { messageId: response.data.messages?.[0]?.id || null },
      "WhatsApp message sent"
    );

    triggerBookingCustomerConfirmation(message);
    return response.data;
  } catch (error) {
    logger.error(
      {
        err: error,
        status: error.response?.status,
        metaError: error.response?.data?.error,
      },
      "WhatsApp send failed"
    );

    throw error;
  }
}

async function sendWhatsAppReplyButtons(to, body, buttons = []) {
  const safeBody = String(body || "").trim();
  if (!safeBody) throw new Error("WhatsApp reply-button body is required");
  if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) {
    throw new Error("WhatsApp reply buttons require between 1 and 3 buttons");
  }
  const normalized = buttons.map((button) => {
    const id = String(button?.id || "").trim();
    const title = String(button?.title || "").trim();
    if (!id || id.length > 256) throw new Error("WhatsApp reply-button id must be 1-256 characters");
    if (!title || title.length > 20) throw new Error("WhatsApp reply-button title must be 1-20 characters");
    return { type: "reply", reply: { id, title } };
  });

  try {
    const response = await axios.post(
      messagesUrl(),
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: safeBody },
          action: { buttons: normalized },
        },
      },
      requestConfig()
    );
    logger.info(
      { messageId: response.data.messages?.[0]?.id || null, buttonCount: normalized.length },
      "WhatsApp reply buttons sent"
    );
    return response.data;
  } catch (error) {
    logger.error(
      {
        err: error,
        status: error.response?.status,
        metaError: error.response?.data?.error,
      },
      "WhatsApp reply-button send failed"
    );
    throw error;
  }
}

async function sendWhatsAppCtaUrl(to, body, displayText, url) {
  const safeBody = String(body || "").trim();
  const safeDisplayText = String(displayText || "").trim();
  const safeUrl = String(url || "").trim();
  if (!safeBody) throw new Error("WhatsApp CTA URL body is required");
  if (!safeDisplayText || safeDisplayText.length > 20) throw new Error("WhatsApp CTA URL display text must be 1-20 characters");
  if (!/^https:\/\//i.test(safeUrl)) throw new Error("WhatsApp CTA URL must use https");

  try {
    const response = await axios.post(
      messagesUrl(),
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: safeBody },
          action: {
            name: "cta_url",
            parameters: {
              display_text: safeDisplayText,
              url: safeUrl,
            },
          },
        },
      },
      requestConfig()
    );
    logger.info(
      { messageId: response.data.messages?.[0]?.id || null },
      "WhatsApp CTA URL sent"
    );
    return response.data;
  } catch (error) {
    logger.error(
      {
        err: error,
        status: error.response?.status,
        metaError: error.response?.data?.error,
      },
      "WhatsApp CTA URL send failed"
    );
    throw error;
  }
}

async function sendWhatsAppList(to, body, buttonText, rows = [], sectionTitle = "Choose") {
  const safeBody = String(body || "").trim();
  const safeButton = String(buttonText || "").trim();
  const safeSection = String(sectionTitle || "Choose").trim();
  if (!safeBody) throw new Error("WhatsApp list body is required");
  if (!safeButton || safeButton.length > 20) throw new Error("WhatsApp list button text must be 1-20 characters");
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 10) throw new Error("WhatsApp list requires between 1 and 10 rows");
  const normalized = rows.map((row) => {
    const id = String(row?.id || "").trim();
    const title = String(row?.title || "").trim();
    const description = String(row?.description || "").trim();
    if (!id || id.length > 200) throw new Error("WhatsApp list row id must be 1-200 characters");
    if (!title || title.length > 24) throw new Error("WhatsApp list row title must be 1-24 characters");
    if (description.length > 72) throw new Error("WhatsApp list row description must be 72 characters or fewer");
    return { id, title, ...(description ? { description } : {}) };
  });

  try {
    const response = await axios.post(
      messagesUrl(),
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: safeBody },
          action: {
            button: safeButton,
            sections: [{ title: safeSection.slice(0, 24), rows: normalized }],
          },
        },
      },
      requestConfig()
    );
    logger.info(
      { messageId: response.data.messages?.[0]?.id || null, rowCount: normalized.length },
      "WhatsApp interactive list sent"
    );
    return response.data;
  } catch (error) {
    logger.error(
      {
        err: error,
        status: error.response?.status,
        metaError: error.response?.data?.error,
      },
      "WhatsApp interactive-list send failed"
    );
    throw error;
  }
}

async function sendWhatsAppTemplate(to, templateName, bodyParameters = [], languageCode = "en", quickReplyPayloads = [], urlButtonParameters = []) {
  const { assertTemplateSendAllowed } = require("./metaTemplateContracts");
  await assertTemplateSendAllowed(templateName, languageCode);
  if (!templateName) {
    throw new Error("WhatsApp template name is required");
  }
  if (!Array.isArray(quickReplyPayloads) || quickReplyPayloads.length > 5) {
    throw new Error("WhatsApp template quick replies require zero to five payloads");
  }
  if (!Array.isArray(urlButtonParameters) || urlButtonParameters.length > 1) {
    throw new Error("WhatsApp template URL buttons require zero or one parameter");
  }

  const components = [];
  if (bodyParameters.length) {
    components.push({
      type: "body",
      parameters: bodyParameters.map((value) => ({ type: "text", text: String(value) })),
    });
  }
  quickReplyPayloads.forEach((payload, index) => {
    const safePayload = String(payload || "").trim();
    if (!safePayload) throw new Error("WhatsApp template quick-reply payload is required");
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(index),
      parameters: [{ type: "payload", payload: safePayload }],
    });
  });
  if (urlButtonParameters.length) {
    const parameter = String(urlButtonParameters[0] || '').trim();
    if (!parameter) throw new Error("WhatsApp template URL button parameter is required");
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: parameter }],
    });
  }

  try {
    const response = await axios.post(
      messagesUrl(),
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(components.length ? { components } : {}),
        },
      },
      requestConfig()
    );

    logger.info(
      {
        messageId: response.data.messages?.[0]?.id || null,
        templateName,
        quickReplyCount: quickReplyPayloads.length,
        urlButtonCount: urlButtonParameters.length,
      },
      "WhatsApp template sent"
    );

    return response.data;
  } catch (error) {
    logger.error(
      {
        err: error,
        status: error.response?.status,
        metaError: error.response?.data?.error,
        templateName,
      },
      "WhatsApp template send failed"
    );
    throw error;
  }
}

module.exports = { sendWhatsAppMessage, sendWhatsAppReplyButtons, sendWhatsAppCtaUrl, sendWhatsAppList, sendWhatsAppTemplate };
