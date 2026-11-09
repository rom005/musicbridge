import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Redis } from 'ioredis';

function fileFor(dataDir, key) {
  // encodeURIComponent is per-character and therefore prefix-preserving,
  // which `deleteByPrefix` relies on.
  return path.join(dataDir, `${encodeURIComponent(key)}.json`);
}

function createFileStore({ dataDir }) {
  const get = async (key) => {
    try {
      return await fs.readFile(fileFor(dataDir, key), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  };

  const set = async (key, value) => {
    await fs.mkdir(dataDir, { recursive: true });
    const file = fileFor(dataDir, key);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, value, 'utf8');
    await fs.rename(tmp, file);
  };

  const del = async (key) => {
    try {
      await fs.unlink(fileFor(dataDir, key));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  };

  const deleteByPrefix = async (prefix) => {
    const encoded = encodeURIComponent(prefix);
    let entries;
    try {
      entries = await fs.readdir(dataDir);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    await Promise.all(
      entries
        .filter((name) => name.startsWith(encoded) && name.endsWith('.json'))
        .map((name) => fs.unlink(path.join(dataDir, name)).catch(() => {}))
    );
  };

  const getJSON = async (key) => {
    const raw = await get(key);
    return raw == null ? null : JSON.parse(raw);
  };

  const setJSON = async (key, value) => set(key, JSON.stringify(value));

  const close = async () => {};

  return { backend: 'file', get, set, delete: del, deleteByPrefix, getJSON, setJSON, close };
}

async function createRedisStore({ redisUrl, namespace }) {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  await redis.ping(); // fail fast if the DB is unreachable

  const get = async (key) => redis.get(namespace + key);
  const set = async (key, value) => {
    await redis.set(namespace + key, value);
  };
  const del = async (key) => {
    await redis.del(namespace + key);
  };
  const deleteByPrefix = async (prefix) => {
    const pattern = `${namespace}${prefix}*`;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  };
  const getJSON = async (key) => {
    const raw = await get(key);
    return raw == null ? null : JSON.parse(raw);
  };
  const setJSON = async (key, value) => set(key, JSON.stringify(value));
  const close = async () => {
    await redis.quit();
  };

  return { backend: 'redis', get, set, delete: del, deleteByPrefix, getJSON, setJSON, close };
}

export async function createStore({
  logger,
  redisUrl,
  dataDir = './data',
  namespace = 'musicbridge:',
} = {}) {
  if (redisUrl) {
    const store = await createRedisStore({ redisUrl, namespace });
    logger?.info?.({ namespace }, 'store: using redis backend');
    return store;
  }
  logger?.info?.({ dataDir }, 'store: using file backend');
  return createFileStore({ dataDir });
}
