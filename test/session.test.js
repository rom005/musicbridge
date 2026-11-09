import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession } from '../src/session.js';

const secret = 'test-secret';

test('sign and verify round-trips the payload', () => {
  const token = signSession({ secret, payload: { role: 'admin' } });
  assert.deepEqual(verifySession({ secret, token }), { role: 'admin' });
});

test('tampered signature fails', () => {
  const token = signSession({ secret, payload: { role: 'admin' } });
  const [v, body] = token.split('.');
  assert.equal(verifySession({ secret, token: `${v}.${body}.AAAA` }), null);
});

test('wrong secret fails', () => {
  const token = signSession({ secret, payload: { role: 'admin' } });
  assert.equal(verifySession({ secret: 'other', token }), null);
});

test('expired token fails', () => {
  const now = Date.now();
  const token = signSession({ secret, payload: { role: 'admin' }, ttlMs: 1000, now });
  assert.deepEqual(verifySession({ secret, token, now: now + 500 }), { role: 'admin' });
  assert.equal(verifySession({ secret, token, now: now + 2000 }), null);
});

test('malformed tokens fail', () => {
  assert.equal(verifySession({ secret, token: 'not-a-token' }), null);
  assert.equal(verifySession({ secret, token: null }), null);
  assert.equal(verifySession({ secret, token: 'v1.abc.def' }), null);
});
