'use strict';
const express = require('express');
const { parseCookieValue, sameOriginGuard } = require('../middleware/staffBrowserSession');
const {
  optionalClientSession,
  requireClientSession,
} = require('../middleware/clientBrowserSession');
const { BOOKING_POLICY_TEXT } = require('../config/bookingPolicyAuthority');

const ROOT = '/my-shiloh/code-auth';
const REVIEW_PATH = ROOT + '/booking/review';
const COOKIE = 'shiloh_booking_continuation';

function tokenFrom(req) {
  const token = parseCookieValue(req.headers.cookie, COOKIE);
  return /^[A-Za-z0-9_-]{70,420}$/.test(token || '') ? token : null;
}
function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}
function page(title, content) {
  return (
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' +
    title +
    ' | Shiloh</title><style>body{margin:0;background:#f7f5ef;color:#20322b;font:1rem/1.55 system-ui}main{margin:1rem auto;padding:1.5rem;max-width:32rem;background:#fffdf9;border:1px solid #dfe5df;border-radius:1rem}h1{line-height:1.15}dt{font-weight:650}dd{margin:0 0 .5rem}details,form{margin-top:1rem}pre{font:inherit;white-space:pre-wrap}button{min-height:48px;margin-top:1rem;width:100%;font:inherit;font-weight:650;background:#294c3c;color:white;border:0;border-radius:.6rem}</style>' +
    '<main><h1>' +
    title +
    '</h1>' +
    content +
    '</main></html>'
  );
}
function reviewPage(review, csrf) {
  const when = new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Africa/Johannesburg',
  }).format(new Date(review.startsAt));
  const figures = [
    ['Treatment', review.service.name],
    ['Practitioner', review.practitioner.name],
    ['When', when],
    ['Price', 'R' + review.price],
    ['Deposit after approval', 'R' + review.deposit],
  ];
  const rows = figures
    .map(([label, value]) => '<dt>' + label + '</dt><dd>' + escapeHtml(value) + '</dd>')
    .join('');
  return page(
    'Review your request',
    '<dl>' +
      rows +
      '</dl><details><summary>Booking Policy &amp; Terms</summary><pre>' +
      escapeHtml(BOOKING_POLICY_TEXT) +
      '</pre></details>' +
      '<form method="post" action="' +
      REVIEW_PATH +
      '">' +
      '<input type="hidden" name="csrf" value="' +
      escapeHtml(csrf) +
      '">' +
      '<input type="hidden" name="reviewHash" value="' +
      escapeHtml(review.reviewHash) +
      '">' +
      '<label><input type="checkbox" name="policyAccepted" value="yes" required> I accept the Booking Policy &amp; Terms.</label>' +
      '<button type="submit">Continue in WhatsApp</button></form>',
  );
}

function createWhatsAppBookingBrowser({
  continuation,
  submit,
  deliverRequestButton,
  sessions,
  env,
}) {
  if (typeof deliverRequestButton !== 'function')
    throw new TypeError('A WhatsApp request button sender is required');
  const router = express.Router();
  const optionalSession = optionalClientSession({ service: sessions, env });
  const requireSession = requireClientSession({ service: sessions, env });
  const cookie = {
    path: ROOT,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
  };
  const unavailable = (_req, res) =>
    res
      .status(409)
      .type('html')
      .send(
        page(
          'Request unavailable',
          '<p>Open your booking link in WhatsApp again or contact Reception for help.</p>',
        ),
      );

  router.use((_req, res, next) => {
    res.set(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    next();
  });
  router.get('/open', optionalSession, (req, res) => {
    const token = req.query.request;
    if (!continuation.selectedMobile(token)) return unavailable(req, res);
    res.cookie(COOKIE, token, { ...cookie, maxAge: 45 * 60 * 1000 });
    return res.redirect(303, req.myShilohClientSession ? REVIEW_PATH : ROOT + '/');
  });
  router.get('/review', requireSession, async (req, res) => {
    const review = await continuation.resume(tokenFrom(req), req.myShilohClientSession);
    if (review?.status !== 'review') return unavailable(req, res);
    const csrf = await sessions.rotateCsrfToken(req.myShilohClientSession.sessionId);
    if (!csrf.ok) return unavailable(req, res);
    return res.type('html').send(reviewPage(review, csrf.csrfToken));
  });
  router.post(
    '/review',
    sameOriginGuard({ env, form: true }),
    requireSession,
    express.urlencoded({ extended: false, limit: '4kb' }),
    async (req, res) => {
      if (!sessions.validateCsrfToken(req.myShilohClientSession, String(req.body?.csrf || '')))
        return res.sendStatus(403);
      const result = await submit({
        token: tokenFrom(req),
        session: req.myShilohClientSession,
        reviewHash: req.body.reviewHash,
        policyAccepted: req.body.policyAccepted === 'yes',
      });
      if (result.status !== 'ready') return unavailable(req, res);
      try {
        await deliverRequestButton({
          recipient: result.recipient,
          action: result.action,
          expiresAt: result.expiresAt,
          deduplicationKey: 'booking-request-button:' + result.acceptanceId,
        });
      } catch {
        return res
          .status(503)
          .type('html')
          .send(
            page(
              'WhatsApp is temporarily unavailable',
              '<p>Please return to your review and try again.</p><a href="' +
                REVIEW_PATH +
                '">Return to review</a>',
            ),
          );
      }
      res.clearCookie(COOKIE, cookie);
      return res
        .type('html')
        .send(
          page(
            'Continue in WhatsApp',
            '<p>Return to your Shiloh WhatsApp chat and tap <strong>Request appointment</strong>. Reception will review your request before asking for any deposit.</p>',
          ),
        );
    },
  );
  return router;
}

module.exports = { createWhatsAppBookingBrowser, REVIEW_PATH, tokenFrom };
