const OpenAI = require("openai");
const { getSession, saveSession } = require("./memory");
const { retrieveKnowledge } = require("./knowledge");
const { getProfile } = require("./profile");
const { getActiveCatalogueKnowledge } = require("./activeCatalogueKnowledge");
const { getPractitionerKnowledge } = require("./practitionerKnowledge");
const { processClinicFaqMessage, getClinicFaqKnowledge } = require("./clinicFaq");
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

async function generateReply(phone, message) {
  const directFaq = processClinicFaqMessage(message);
  if (directFaq.handled) return directFaq.reply;

  const deterministicReply = deterministicConversationReply(message);
  if (deterministicReply) return deterministicReply;

  const [previousResponseId, knowledge, profile, activeCatalogue, practitionerKnowledge] = await Promise.all([
    getSession(phone),
    retrieveKnowledge(message, 5),
    getProfile(phone),
    getActiveCatalogueKnowledge(),
    getPractitionerKnowledge(),
  ]);

  const clinicFaqKnowledge = getClinicFaqKnowledge(message);
  const authoritativeKnowledge = [activeCatalogue, practitionerKnowledge, clinicFaqKnowledge, ...knowledge].filter(Boolean);
  const workload = "conversation";
  const request = {
    model: getModelForWorkload(workload),
    input: message,
    instructions: buildInstructions({ profile, knowledge: authoritativeKnowledge }),
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
      await saveSession(phone, response.id);
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
