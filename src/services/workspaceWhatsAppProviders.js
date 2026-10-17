'use strict';
const { createWorkspaceOtpDelivery, inspectWorkspaceTemplate } = require('./workspaceWhatsAppTemplate');
const { createSmsMessengerGateway } = require('./clientSmsAuth');
const SMS_URL = 'https://sms1.smsmessenger.co.za/app/api/rest/v1/sms/send.json';
const id = value => typeof value === 'string' && /^[0-9]{1,30}$/.test(value);
const credential = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\r\n]/.test(value);

// Explicit fetch injection only. One request, no redirects/retries, bounded body
// and elapsed time (including body consumption). Raw exceptions never escape.
function createBoundedJsonRequest({ fetchImpl, timeoutMs = 8000, maxBytes = 65536 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 ||
      !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 262144) return null;
  return async (url, options) => {
    const controller = new AbortController(); let timer, reader;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Provider unavailable')); }, timeoutMs); });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(url, { ...options, redirect:'error', signal:controller.signal });
        if (response.redirected || response.status >= 300 && response.status < 400 || !response.body?.getReader) throw Error('Provider unavailable');
        const size = Number(response.headers?.get('content-length'));
        if (Number.isFinite(size) && size > maxBytes) throw Error('Provider unavailable');
        reader = response.body.getReader(); const chunks = []; let total = 0;
        for (;;) {
          const {done,value} = await reader.read(); if (done) break;
          total += value.byteLength; if (total > maxBytes) throw Error('Provider unavailable');
          chunks.push(Buffer.from(value));
        }
        return { ok:response.ok, status:response.status, body:JSON.parse(Buffer.concat(chunks).toString('utf8')) };
      })()]);
    } catch (_) { throw Error('Provider unavailable'); }
    finally { clearTimeout(timer); controller.abort(); if (reader) void reader.cancel().catch(() => {}); }
  };
}

function createWorkspaceMetaProvider({ enabled = false, reviewed = null, wabaId, phoneNumberId,
  apiVersion, accessToken, fetchImpl, timeoutMs, maxBytes, expectedName = 'shiloh_workspace_verification' } = {}) {
  const request = createBoundedJsonRequest({fetchImpl,timeoutMs,maxBytes});
  const configured = enabled === true && !!request && id(wabaId) && id(phoneNumberId) &&
    /^v[0-9]{1,3}\.[0-9]{1,2}$/.test(apiVersion || '') && credential(accessToken) &&
    reviewed?.wabaId === wabaId && id(reviewed?.id) &&
    inspectWorkspaceTemplate({reviewed,expectedName,inventory:reviewed ? [{...reviewed,status:'APPROVED'}] : [],wabaId}).ready; // structural validation only; live readiness rechecks inventory
  const root = `https://graph.facebook.com/${apiVersion}`;
  const headers = {Authorization:`Bearer ${accessToken}`,Accept:'application/json','Content-Type':'application/json'};
  const delivery = createWorkspaceOtpDelivery({enabled:configured,reviewed,wabaId,expectedName,
    readInventory: async () => {
      // Bind the configured sending phone to this WABA, never trust a caller URL
      // or follow paging.next. Oversized/paginated inventories fail closed.
      const phones = await request(`${root}/${wabaId}/phone_numbers?fields=id&limit=100`,{method:'GET',headers});
      if (!phones.ok || phones.body.error || !Array.isArray(phones.body.data) || phones.body.paging?.next ||
          phones.body.data.filter(p => p.id === phoneNumberId).length !== 1) throw Error('Provider unavailable');
      const templates = await request(`${root}/${wabaId}/message_templates?name=${encodeURIComponent(reviewed.name)}&fields=id,name,language,status,category,components,message_send_ttl_seconds&limit=100`,{method:'GET',headers});
      if (!templates.ok || templates.body.error || !Array.isArray(templates.body.data) || templates.body.paging?.next) throw Error('Provider unavailable');
      return templates.body.data;
    },
    send: async payload => {
      const result = await request(`${root}/${phoneNumberId}/messages`,{method:'POST',headers,body:JSON.stringify(payload)});
      if (!result.ok || result.body.error) throw Error('Provider unavailable');
      return result.body;
    },
  });
  return delivery;
}

function createWorkspaceSmsProvider({enabled = false, accountEmail, apiToken, fetchImpl, timeoutMs, maxBytes, audience='staff'} = {}) {
  const request = createBoundedJsonRequest({fetchImpl,timeoutMs,maxBytes});
  const configured = () => enabled === true && !!request && credential(accountEmail) && credential(apiToken);
  // Reuse the existing SMSMessenger endpoint, authentication and response
  // contract, but supply explicit credentials and a bounded fetch implementation.
  const gateway = createSmsMessengerGateway({env:{SMSMESSENGER_ACCOUNT_EMAIL:accountEmail,SMSMESSENGER_API_TOKEN:apiToken},
    fetchImpl:async (url, options) => {
      if (url !== SMS_URL || options.method !== 'POST') throw Error('Provider unavailable');
      const result = await request(url,options);
      return {ok:result.ok,status:result.status,text:async()=>JSON.stringify(result.body)};
    }});
  return { configured, readiness:async()=>({ready:configured(),codeTtlSeconds:300}),
    async deliver({mobile,code,codeTtlSeconds}) {
      if (!configured() || codeTtlSeconds !== 300 || !/^27[6-8][0-9]{8}$/.test(mobile || '') || !/^[0-9]{6}$/.test(code || '')) return {ok:false,outcome:'not_sent'};
      try {
        const messageId = await gateway.sendWorkspaceCode({mobile,code,audience});
        if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(messageId)) return {ok:false,outcome:'uncertain'};
        return {ok:true,outcome:'accepted',providerMessageId:`sms.${messageId}`};
      } catch (_) { return {ok:false,outcome:'uncertain'}; }
    },
  };
}
module.exports = {createWorkspaceMetaProvider,createWorkspaceSmsProvider,createBoundedJsonRequest};
