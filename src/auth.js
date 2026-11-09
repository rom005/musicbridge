import { initAuthCreds, makeCacheableSignalKeyStore, BufferJSON, proto } from './baileys.js';

const CREDS_KEY = 'auth:creds';
const KEY_PREFIX = 'auth:key:';

// Mirrors Baileys' useMultiFileAuthState, but persists to our KeyValueStore
// instead of disk. Signal key values are heterogeneous (Buffers, Uint8Arrays,
// proto objects, plain objects) so we serialize with BufferJSON.replacer/reviver
// rather than plain JSON.stringify.
export async function createAuthState({ store, logger }) {
  const rawCreds = await store.get(CREDS_KEY);
  let creds = rawCreds ? JSON.parse(rawCreds, BufferJSON.reviver) : initAuthCreds();

  const keys = {
    async get(type, ids) {
      const data = {};
      await Promise.all(
        ids.map(async (id) => {
          const raw = await store.get(`${KEY_PREFIX}${type}:${id}`);
          if (raw == null) return;
          let value = JSON.parse(raw, BufferJSON.reviver);
          if (type === 'app-state-sync-key') {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          data[id] = value;
        })
      );
      return data;
    },

    async set(data) {
      for (const category in data) {
        for (const id in data[category]) {
          const value = data[category][id];
          const key = `${KEY_PREFIX}${category}:${id}`;
          if (value) {
            await store.set(key, JSON.stringify(value, BufferJSON.replacer));
          } else {
            await store.delete(key);
          }
        }
      }
    },
  };

  return {
    state: { creds, keys: makeCacheableSignalKeyStore(keys, logger) },
    saveCreds: async () => {
      await store.set(CREDS_KEY, JSON.stringify(creds, BufferJSON.replacer));
    },
    clearAuth: async () => {
      await store.delete(CREDS_KEY);
      await store.deleteByPrefix(KEY_PREFIX);
    },
  };
}
