'use strict';

// Generated money labels share the existing South African currency convention.
// Stored service names and prices remain canonical business data.
const randFormatter = new Intl.NumberFormat('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatRand(value) {
  return `R${randFormatter.format(Number(value || 0))}`;
}
module.exports = { formatRand };
