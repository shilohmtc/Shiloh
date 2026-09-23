const test = require("node:test");
const assert = require("node:assert/strict");

const {
  POLICY_VERSION,
  POLICY_TEXT,
  sanitizeBookingReply,
  isExplicitAcceptance,
} = require("../src/services/bookingPolicy");

test("booking policy is versioned and requires explicit acceptance", () => {
  assert.equal(POLICY_VERSION, "2026-09-23-v2");
  assert.match(POLICY_TEXT, /strictly professional and non-sexual/i);
  assert.match(POLICY_TEXT, /50% booking deposit/i);
  assert.match(POLICY_TEXT, /48\+ hours/i);
  assert.match(POLICY_TEXT, /24–48 hours/i);
  assert.match(POLICY_TEXT, /Marietjie/i);
  assert.match(POLICY_TEXT, /Rescheduling keeps the existing booking payment\/deposit record/i);
  assert.match(POLICY_TEXT, /health, medical, pregnancy, allergy, medication/i);
  assert.match(POLICY_TEXT, /reply exactly: \*I AGREE\*/i);
});

test("explicit policy acceptance is narrow and deliberate", () => {
  assert.equal(isExplicitAcceptance("I AGREE"), true);
  assert.equal(isExplicitAcceptance("I accept"), true);
  assert.equal(isExplicitAcceptance("yes"), false);
  assert.equal(isExplicitAcceptance("ok"), false);
  assert.equal(isExplicitAcceptance("continue"), false);
});

test("customer booking summary no longer directs clients to retired Goldie booking", () => {
  const oldReply = "Reply YES to continue to Goldie, or tell me what you'd like to change.";
  const cleaned = sanitizeBookingReply(oldReply);
  assert.doesNotMatch(cleaned, /continue to Goldie/i);
  assert.match(cleaned, /Booking Policy & Terms/i);
  assert.match(cleaned, /explicit acceptance/i);
});