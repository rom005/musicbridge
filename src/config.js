export function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT || '3000', 10);
  const host = env.HOST || '0.0.0.0';
  const spotifyClientId = (env.SPOTIFY_CLIENT_ID || '').trim();
  const spotifyClientSecret = (env.SPOTIFY_CLIENT_SECRET || '').trim();
  const adminPassword = env.ADMIN_PASSWORD || '';
  const sessionSecret = (env.SESSION_SECRET || '').trim();
  const redisUrl = (env.REDIS_URL || '').trim();
  const dataDir = env.DATA_DIR || './data';
  const logLevel = env.LOG_LEVEL || 'info';
  const isProd = env.NODE_ENV === 'production' || Boolean(redisUrl);

  const missing = [];
  if (!spotifyClientId) missing.push('SPOTIFY_CLIENT_ID');
  if (!spotifyClientSecret) missing.push('SPOTIFY_CLIENT_SECRET');
  if (!adminPassword) missing.push('ADMIN_PASSWORD');
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (!sessionSecret) {
    // eslint-disable-next-line no-console
    console.warn(
      '[config] SESSION_SECRET is not set; falling back to ADMIN_PASSWORD. Set a long random value in production.'
    );
  }

  return {
    port,
    host,
    spotifyClientId,
    spotifyClientSecret,
    adminPassword,
    sessionSecret: sessionSecret || adminPassword,
    redisUrl: redisUrl || null,
    dataDir,
    logLevel,
    isProd,
  };
}
