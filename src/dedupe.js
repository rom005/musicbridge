export function createDedupe({ ttlMs = 10 * 60 * 1000, max = 5000, now = Date.now } = {}) {
  const map = new Map(); // key -> expiresAt

  function has(key) {
    const expiresAt = map.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now()) {
      map.delete(key);
      return false;
    }
    return true;
  }

  function add(key) {
    map.delete(key); // move to the end to keep insertion order meaningful
    map.set(key, now() + ttlMs);
    while (map.size > max) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }

  return { has, add };
}
