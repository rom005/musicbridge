import test from 'node:test';
import assert from 'node:assert/strict';
import { createDedupe } from '../src/dedupe.js';

test('add then has', () => {
  const d = createDedupe();
  assert.equal(d.has('a'), false);
  d.add('a');
  assert.equal(d.has('a'), true);
});

test('entries expire after ttl', () => {
  let now = 0;
  const d = createDedupe({ ttlMs: 100, now: () => now });
  d.add('a');
  now = 99;
  assert.equal(d.has('a'), true);
  now = 101;
  assert.equal(d.has('a'), false);
});

test('max cap evicts the oldest entry', () => {
  const d = createDedupe({ max: 2 });
  d.add('a');
  d.add('b');
  d.add('c');
  assert.equal(d.has('a'), false);
  assert.equal(d.has('b'), true);
  assert.equal(d.has('c'), true);
});
