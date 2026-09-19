const OpenAI = require("openai");
const { getSession, saveSession } = require("./memory");
const { retrieveKnowledge } = require("./knowledge");
const { getProfile } = require("./profile");
const { getActiveCatalogueKnowledge } = require("./activeCatalogueKnowledge");
const { getPractitionerKnowledge } = require("./practitionerKnowledge");
const { processClinicFaqMessage, getClinicFaqKnowledge } = require("./clinicFaq");
const { getHeidelbergGuideKnowledge, buildHeidelbergGuideReply } = require("../config/heidelbergGuide");
const { isLivePlacesQuery, searchGooglePlaces, buildGooglePlacesReply } = require("./googlePlaces");
const { buildInstructions } = require("./orchestrator");
const logger = require("../lib/logger");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const PRIMARY_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";
const FAST_MODEL = process.env.OPENAI_FAST_MODEL || "gpt-5.6-luna";
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "low";

function deterministicConversationReply(message = "") {
  const text = String(message).trim();
  const nameMatch = text.match(/^(?:my name is|call me)\s+([A-Za-z][A-Za-z' -]{1,60})[.!?]*$/i);
  if (nameMatch && !/^(?:incorrect|wrong|not correct)$/i.test(nameMatch[1].trim())) {
    const name = nameMatch[1].trim();
    return `Thanks, ${name}! I’ll use that name going forward. How can I help you with Shiloh today?`;
  }

  if (/(?:not sure|unsure)\s+(?:what|which)\s+i\s+need/i.test(text)
    || /(?:can|could)\s+you\s+help\s+me\s+choose/i.test(text)) {
    return "Of course — I can help you choose. Are you looking for massage, skincare or a facial, foot care, or an advanced aesthetic treatment?";
  }

  return null;
}

function getModelForWorkload(workload = "conversation") {
  return workload === "fast" ? FAST_MODEL : PRIMARY_MODEL;
}

function logUsage(response, workload) {
  const usage = response?.usage;
  if (!usage) return;

  logger.info(
    {
      provider: "openai",
      workload,
      model: response.model || getModelForWorkload(workload),
      responseId: response.id,
      inputTokens: usage.input_tokens,
      cachedInputTokens: usage.input_tokens_details?.cached_tokens || 0,
      outputTokens: usage.output_tokens,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens || 0,
      totalTokens: usage.total_tokens,
    },
    "OpenAI usage"
  );
}

async function generateReply(phone, message, {
  conversationKey = phone,
  profileOverride,
  clientContext = null,
  surface = "whatsapp",
} = {}) {
  const directFaq = processClinicFaqMessage(message);
  if (directFaq.handled) return directFaq.reply;

  if (surface === "whatsapp") {
    const deterministicReply = deterministicConversationReply(message);
    if (deterministicReply) return deterministicReply;
  }

  if (isLivePlacesQuery(message)) {
    const livePlaces = await searchGooglePlaces(message);
    const livePlacesReply = buildGooglePlacesReply(livePlaces, message);
    if (livePlacesReply) return livePlacesReply;
  }

  const localGuideReply = buildHeidelbergGuideReply(message);
  if (localGuideReply) return localGuideReply;

  const [previousResponseId, knowledge, profile, activeCatalogue, practitionerKnowledge] = await Promise.all([
    getSession(conversationKey),
    retrieveKnowledge(message, 5),
    profileOverride !== undefined ? Promise.resolve(profileOverride) : getProfile(phone),
    getActiveCatalogueKnowledge(),
    getPractitionerKnowledge(),
  ]);

  const clinicFaqKnowledge = getClinicFaqKnowledge(message);
  const heidelbergGuideKnowledge = getHeidelbergGuideKnowledge(message);
  const authoritativeKnowledge = [activeCatalogue, practitionerKnowledge, clinicFaqKnowledge, heidelbergGuideKnowledge, ...knowledge].filter(Boolean);
  const workload = "conversation";
  const request = {
    model: getModelForWorkload(workload),
    input: message,
    instructions: buildInstructions({
      profile,
      knowledge: authoritativeKnowledge,
      clientContext,
      surface,
    }),
    reasoning: { effort: REASONING_EFFORT },
    store: true,
  };

  if (previousResponseId) {
    request.previous_response_id = previousResponseId;
  }

  try {
    const response = await client.responses.create(request);

    logUsage(response, workload);

    if (response.id) {
      await saveSession(conversationKey, response.id);
    }

    const reply = response.output_text?.trim();

    if (!reply) {
      logger.warn({ responseId: response.id }, "OpenAI returned no text output");
      return "Sorry, I couldn't generate a response right now.";
    }

    return reply;
  } catch (error) {
    logger.error(
      {
        err: error,
        status: error.status,
        code: error.code,
        model: getModelForWorkload("conversation"),
      },
      "OpenAI response generation failed"
    );

    throw error;
  }
}

module.exports = {
  generateReply,
  getModelForWorkload,
  deterministicConversationReply,
};
