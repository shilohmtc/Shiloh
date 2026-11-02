'use strict';

const { CLINIC_FAQ_POLICY, FAQ_UNKNOWN_REPLY } = require('../config/clinicFaqPolicy');

const CANONICAL_AUTHORITY_PATTERN = /\b(?:price|prices|cost|costs|how\s+much|available|availability|book|booking|appointment|appointments|slot|slots|reschedule|cancel|cancellation|service|services|treatment|treatments|massage|facial|therapist|therapists|practitioner|practitioners|duration|opening\s+hours|hours|address|location|contact)\b/i;
const POLICY_QUESTION_PATTERN = /\b(?:can|could|may|allowed|allow|permit|permitted|bring|serve|served|provide|provided|have|has|offer|offered|wear|wearing|take|use)\b/i;

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function tokenMatches(inputToken, candidateToken) {
  if (!inputToken || !candidateToken) return false;
  if (inputToken === candidateToken) return true;
  if (inputToken.length < 5 || candidateToken.length < 5) return false;
  const maxDistance = Math.max(1, Math.floor(Math.max(inputToken.length, candidateToken.length) * 0.2));
  return editDistance(inputToken, candidateToken) <= maxDistance;
}

function scoreEntry(message, entry) {
  const normalized = normalizeText(message);
  if (!normalized) return 0;
  const inputTokens = normalized.split(' ');
  let score = 0;

  for (const alias of entry.aliases || []) {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias) continue;
    if ((` ${normalized} `).includes(` ${normalizedAlias} `)) score = Math.max(score, 10 + normalizedAlias.split(' ').length);
  }

  for (const topic of entry.topics || []) {
    const normalizedTopic = normalizeText(topic);
    if (!normalizedTopic) continue;
    if ((` ${normalized} `).includes(` ${normalizedTopic} `)) {
      score += normalizedTopic.includes(' ') ? 5 : 3;
      continue;
    }
    const topicTokens = normalizedTopic.split(' ');
    if (topicTokens.length === 1 && inputTokens.some(token => tokenMatches(token, topicTokens[0]))) score += 2;
  }

  return score;
}

function resolveClinicFaq(message, entries = CLINIC_FAQ_POLICY) {
  const ranked = entries
    .map(entry => ({ entry, score: scoreEntry(message, entry) }))
    .filter(item => item.score >= 2)
    .sort((a, b) => b.score - a.score || String(a.entry.id).localeCompare(String(b.entry.id)));

  if (!ranked.length) return { kind: 'none', matches: [] };

  const top = ranked[0].score;
  const tied = ranked.filter(item => item.score >= top - 1);
  if (tied.length > 1) {
    return {
      kind: 'ambiguous',
      matches: tied.map(item => item.entry),
    };
  }

  const entry = ranked[0].entry;
  return {
    kind: entry.status === 'confirmed' && entry.answer ? 'answer' : 'unknown',
    entry,
    matches: [entry],
  };
}

function isCanonicalAuthorityQuery(message) {
  return CANONICAL_AUTHORITY_PATTERN.test(String(message || ''));
}

function looksLikeClinicPolicyQuestion(message) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  return /\b(?:policy|policies|allowed|permit|permitted|bring|wear|wearing)\b/i.test(normalized) && POLICY_QUESTION_PATTERN.test(normalized) && /\b(?:you|we|i|my|us|clinic|shiloh)\b/i.test(normalized);
}

function ambiguousReply(matches = []) {
  const titles = matches.map(item => item.title).filter(Boolean).slice(0, 3);
  if (!titles.length) return 'Could you clarify which clinic policy you mean?';
  if (titles.length === 1) return `Could you clarify what you would like to know about ${titles[0].toLowerCase()}?`;
  return `Could you clarify which you mean: ${titles.join(' or ')}?`;
}

function processClinicFaqMessage(message, { entries = CLINIC_FAQ_POLICY } = {}) {
  const resolution = resolveClinicFaq(message, entries);
  const canonicalAuthority = isCanonicalAuthorityQuery(message);

  // Mixed or transactional questions must remain with the existing canonical
  // service/booking assistant path. FAQ context can still be injected later.
  if (canonicalAuthority) return { handled: false, resolution, reason: 'canonical_authority' };

  if (resolution.kind === 'answer') {
    return { handled: true, reply: resolution.entry.answer, resolution };
  }
  if (resolution.kind === 'unknown') {
    return { handled: true, reply: FAQ_UNKNOWN_REPLY, resolution };
  }
  if (resolution.kind === 'ambiguous') {
    return { handled: true, reply: ambiguousReply(resolution.matches), resolution };
  }
  if (looksLikeClinicPolicyQuestion(message)) {
    return {
      handled: true,
      reply: FAQ_UNKNOWN_REPLY,
      resolution: { kind: 'unknown-policy', matches: [] },
    };
  }
  return { handled: false, resolution };
}

function getClinicFaqKnowledge(message, { entries = CLINIC_FAQ_POLICY } = {}) {
  const resolution = resolveClinicFaq(message, entries);
  if (resolution.kind === 'none') return null;

  if (resolution.kind === 'answer') {
    return {
      title: resolution.entry.title,
      source: 'Shiloh clinic-owned FAQ policy',
      similarity: 1,
      content: `CONFIRMED CLINIC POLICY: ${resolution.entry.answer}`,
    };
  }

  if (resolution.kind === 'unknown') {
    return {
      title: resolution.entry.title,
      source: 'Shiloh clinic-owned FAQ policy',
      similarity: 1,
      content: 'NO MAINTAINED CLINIC POLICY IS RECORDED FOR THIS TOPIC. Do not infer or invent an answer. Say the policy is not available and ask the client to confirm with the clinic team.',
    };
  }

  return {
    title: 'Ambiguous clinic FAQ request',
    source: 'Shiloh clinic-owned FAQ policy',
    similarity: 1,
    content: `AMBIGUOUS CLINIC POLICY REQUEST. Ask which topic the client means before answering: ${resolution.matches.map(item => item.title).join('; ')}.`,
  };
}

module.exports = {
  normalizeText,
  editDistance,
  resolveClinicFaq,
  isCanonicalAuthorityQuery,
  looksLikeClinicPolicyQuestion,
  processClinicFaqMessage,
  getClinicFaqKnowledge,
};
