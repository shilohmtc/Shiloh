'use strict';
const crypto=require('node:crypto');
const b64url=b=>Buffer.from(b).toString('base64url');
const ORIGIN='https://staff.example.test', RP_ID='staff.example.test';
function encLen(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  throw new Error('test cbor length');
}
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? encLen(0, v) : encLen(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([encLen(2, v.length), v]);
  if (typeof v === 'string') {
    const b = Buffer.from(v);
    return Buffer.concat([encLen(3, b.length), b]);
  }
  if (v instanceof Map) {
    const parts = [encLen(5, v.size)];
    for (const [k, val] of v) parts.push(cbor(k), cbor(val));
    return Buffer.concat(parts);
  }
  throw new Error('unsupported test cbor');
}
function clientData(type, challenge, origin = ORIGIN) {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}
function authData({
  credentialId = null,
  cose = null,
  signCount = 0,
  flags = 0x05,
  rpId = RP_ID,
} = {}) {
  const head = Buffer.alloc(37);
  crypto.createHash('sha256').update(rpId).digest().copy(head, 0);
  head[32] = flags;
  head.writeUInt32BE(signCount, 33);
  if (!credentialId) return head;
  const aaguid = Buffer.alloc(16);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(credentialId.length);
  return Buffer.concat([head, aaguid, len, credentialId, cbor(cose)]);
}
function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]);
  const credentialId = crypto.randomBytes(32);
  const challenge = crypto.randomBytes(32).toString('base64url');
  return { publicKey, privateKey, cose, credentialId, challenge };
}
function registrationResponse(
  f,
  { origin = ORIGIN, challenge = f.challenge, rpId = RP_ID, flags = 0x45 } = {},
) {
  const cd = clientData('webauthn.create', challenge, origin);
  const ad = authData({ credentialId: f.credentialId, cose: f.cose, signCount: 0, flags, rpId });
  const att = cbor(
    new Map([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', ad],
    ]),
  );
  return {
    id: b64url(f.credentialId),
    rawId: b64url(f.credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64url(cd),
      attestationObject: b64url(att),
      transports: ['internal'],
    },
  };
}

module.exports={fixture,registrationResponse,ORIGIN,RP_ID};
