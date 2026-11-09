import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mb-store-'));
  const store = await createStore({ dataDir: dir });
  return { store, dir };
}

test('string round-trip', async () => {
  const { store } = await tempStore();
  await store.set('k', 'hello');
  assert.equal(await store.get('k'), 'hello');
  assert.equal(await store.get('missing'), null);
});

test('json round-trip', async () => {
  const { store } = await tempStore();
  await store.setJSON('k', { a: 1, b: [2, 3], c: null });
  assert.deepEqual(await store.getJSON('k'), { a: 1, b: [2, 3], c: null });
});

test('delete removes a key', async () => {
  const { store } = await tempStore();
  await store.set('k', 'x');
  await store.delete('k');
  assert.equal(await store.get('k'), null);
});

test('deleteByPrefix removes only matching keys', async () => {
  const { store } = await tempStore();
  await store.set('auth:creds', '1');
  await store.set('auth:key:session:abc', '2');
  await store.set('auth:key:pre-key:1', '3');
  await store.set('config:selectedGroup', 'g@g.us');

  await store.deleteByPrefix('auth:key:');

  assert.equal(await store.get('auth:creds'), '1');
  assert.equal(await store.get('auth:key:session:abc'), null);
  assert.equal(await store.get('auth:key:pre-key:1'), null);
  assert.equal(await store.get('config:selectedGroup'), 'g@g.us');
});

test('keys with special characters are safely encoded', async () => {
  const { store } = await tempStore();
  const key = 'auth:key:session:1@2:3/4';
  await store.set(key, 'v');
  assert.equal(await store.get(key), 'v');
});
