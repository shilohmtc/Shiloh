'use strict';

// Accepted 20 October 2026. Independent of staff counters and credentials.
const CLIENT_DAILY_BUDGET_MINOR = 500;
const clientDetailsRetired = (env = process.env) => env.MY_SHILOH_CRM_AUTH_RETIRED === 'true';
function validClientBudget(budget) {
  return budget?.currency === 'ZAR' && Number.isSafeInteger(budget.dailyMinor) &&
    budget.dailyMinor > 0 && budget.dailyMinor <= CLIENT_DAILY_BUDGET_MINOR &&
    Number.isSafeInteger(budget.whatsappCostMinor) && budget.whatsappCostMinor > 0 &&
    budget.whatsappCostMinor <= budget.dailyMinor;
}
function clientBudgetBuckets({budget,channel,digest,current}) {
  if (budget === null) return []; // Isolated pre-existing synthetic composition.
  if (!validClientBudget(budget) || channel !== 'whatsapp') throw Error('Client allowance unavailable');
  const local = current.getTime() + 7200000;
  return [{key:digest('client-money-day',new Date(local).toISOString().slice(0,10)),
    limit:budget.dailyMinor,amount:budget.whatsappCostMinor,windowMs:86400000-local%86400000}];
}
module.exports={CLIENT_DAILY_BUDGET_MINOR,clientDetailsRetired,validClientBudget,clientBudgetBuckets};
