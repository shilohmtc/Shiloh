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

function functionCalls(response) {
  return Array.isArray(response?.output)
    ? response.output.filter(item => item?.type === 'function_call' && item.name && item.call_id)
    : [];
}

function parseToolArguments(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return null;
  }
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

async function runReadToolLoop({
  responsesClient,
  response,
  instructions,
  tools,
  toolExecutor,
  workload = 'conversation',
  maxToolRounds = 4,
} = {}) {
  const enabledTools = Array.isArray(tools) && typeof toolExecutor === 'function' ? tools : [];
  let current = response;
  let rounds = 0;

  while (enabledTools.length && functionCalls(current).length) {
    if (rounds >= Math.max(1, Number(maxToolRounds) || 4)) {
      logger.warn({ responseId: current?.id, rounds }, "OpenAI tool round limit reached");
      return { response: current, limitReached: true, rounds };
    }

    const outputs = [];
    for (const call of functionCalls(current)) {
      const args = parseToolArguments(call.arguments);
      let result;
      if (!args) {
        result = { ok: false, error: 'invalid_tool_arguments' };
      } else {
        try {
          result = await toolExecutor(call.name, args);
        } catch (toolError) {
          logger.warn({ err: toolError, toolName: call.name }, "Shiloh read tool failed");
          result = { ok: false, error: 'tool_unavailable' };
        }
      }
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }

    current = await responsesClient.responses.create({
      model: getModelForWorkload(workload),
      previous_response_id: current.id,
      input: outputs,
      instructions,
      tools: enabledTools,
      parallel_tool_calls: false,
      reasoning: { effort: REASONING_EFFORT },
      store: true,
    });
    logUsage(current, workload);
    rounds += 1;
  }

  return { response: current, limitReached: false, rounds };
}

async function generateReply(phone, message, {
  conversationKey = phone,
  profileOverride,
  clientContext = null,
  surface = "whatsapp",
  tools = [],
  toolExecutor = null,
  maxToolRounds = 4,
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
  const instructions = buildInstructions({
    profile,
    knowledge: authoritativeKnowledge,
    clientContext,
    surface,
  });
  const enabledTools = Array.isArray(tools) && typeof toolExecutor === 'function' ? tools : [];
  const request = {
    model: getModelForWorkload(workload),
    input: message,
    instructions,
    reasoning: { effort: REASONING_EFFORT },
    store: true,
  };

  if (enabledTools.length) {
    request.tools = enabledTools;
    request.parallel_tool_calls = false;
  }

  if (previousResponseId) {
    request.previous_response_id = previousResponseId;
  }

  try {
    let response = await client.responses.create(request);
    logUsage(response, workload);

    const toolRun = await runReadToolLoop({
      responsesClient: client,
      response,
      instructions,
      tools: enabledTools,
      toolExecutor,
      workload,
      maxToolRounds,
    });
    response = toolRun.response;
    if (toolRun.limitReached) {
      return "I couldn't finish checking that safely just now. Please try again.";
    }

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
  functionCalls,
  parseToolArguments,
  runReadToolLoop,
};
