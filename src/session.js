import crypto from 'node:crypto';

const VERSION = 'v1';

function b64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlDecode(input) {
  return Buffer.from(input, 'base64url');
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

export function signSession({ secret, payload, ttlMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  const body = { p: payload, exp: now + ttlMs };
  const bodyB64 = b64urlEncode(JSON.stringify(body));
  const sig = b64urlEncode(hmac(secret, `${VERSION}.${bodyB64}`));
  return `${VERSION}.${bodyB64}.${sig}`;
}

export function verifySession({ secret, token, now = Date.now() } = {}) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;

  const [, bodyB64, sigB64] = parts;
  const expected = hmac(secret, `${VERSION}.${bodyB64}`);
  const provided = b64urlDecode(sigB64);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  let body;
  try {
    body = JSON.parse(b64urlDecode(bodyB64).toString('utf8'));
  } catch {
    return null;
  }

  if (typeof body.exp !== 'number' || body.exp <= now) return null;
  return body.p;
}
