const assert = require('node:assert/strict');

// Match the target's closing section, including nested sections. Ignore markup
// strings in style/script blocks rather than depending on a neighbour's order.
function extractHtmlSection(html, attribute) {
  assert.match(attribute, /^[a-z][a-z0-9-]*$/);
  const tokens = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<\/?section\b[^>]*>/gi)];
  const targets = tokens.filter(token => /^<section\b/i.test(token[0]) && new RegExp(`\\s${attribute}(?:\\s|=|>)`).test(token[0]));
  assert.equal(targets.length, 1, `${attribute} must identify exactly one section`);
  const start = targets[0].index;
  let depth = 0;
  for (const token of tokens) {
    if (token.index < start || !/^<\/?section\b/i.test(token[0])) continue;
    depth += /^<\/section\b/i.test(token[0]) ? -1 : 1;
    if (depth === 0) return html.slice(start, token.index + token[0].length);
  }
  assert.fail(`${attribute} section must close`);
}

module.exports = { extractHtmlSection };
