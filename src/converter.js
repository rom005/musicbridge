import * as cheerio from 'cheerio';
import axios from 'axios';

export class ConversionError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ConversionError';
  }
}

const APPLE_URL_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*music\.apple\.com\/[^\s"'<>()]+/gi;

function isAppleHostname(hostname) {
  return hostname === 'music.apple.com' || hostname.endsWith('.music.apple.com');
}

export function extractAppleMusicUrl(text) {
  if (typeof text !== 'string' || !text) return null;
  const match = text.match(APPLE_URL_RE);
  if (!match) return null;
  let url = match[0].replace(/[.,;:!?]+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

export function normalizeAppleLink(link) {
  if (typeof link !== 'string' || !link) return null;
  let parsed;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!isAppleHostname(parsed.hostname)) return null;
  return parsed.toString();
}

export function isAppleSongUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes('/song/') || parsed.searchParams.has('i');
  } catch {
    return false;
  }
}

const SPOTIFY_TYPES = ['track', 'album', 'artist', 'playlist', 'episode', 'show', 'audiobook'];

export function spotifyUrlToUri(spotifyUrl) {
  let parsed;
  try {
    parsed = new URL(spotifyUrl);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'open.spotify.com' && !parsed.hostname.endsWith('.spotify.com')) {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (SPOTIFY_TYPES.includes(parts[i])) {
      const id = parts[i + 1].split('?')[0];
      return `spotify:${parts[i]}:${id}`;
    }
  }
  return null;
}

export function createTokenCache({ ttlMs = 50 * 60 * 1000, now = Date.now } = {}) {
  let token = null;
  let expiresAt = 0;
  return {
    get() {
      if (token && expiresAt > now()) return token;
      return null;
    },
    set(value) {
      token = value;
      expiresAt = now() + ttlMs;
    },
  };
}

export function createAxiosHttp({ timeoutMs = 10000 } = {}) {
  return {
    async get(url, { headers = {} } = {}) {
      const res = await axios.get(url, { headers, timeout: timeoutMs });
      return { data: res.data, status: res.status };
    },
    async post(url, body, { headers = {} } = {}) {
      const res = await axios.post(url, body, { headers, timeout: timeoutMs });
      return { data: res.data, status: res.status };
    },
  };
}

export async function getSpotifyToken({ http, credentials }) {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
  const res = await http.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  if (!res.data?.access_token) {
    throw new ConversionError('Spotify token response missing access_token');
  }
  return res.data.access_token;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

export async function getAppleMetadata(appleLink, { http }) {
  const res = await http.get(appleLink, { headers: BROWSER_HEADERS });
  const $ = cheerio.load(res.data);
  const jsonLdScript = $('#schema\\:song').html();
  if (!jsonLdScript) {
    throw new ConversionError('Apple Music page did not contain song metadata (#schema:song)');
  }
  let jsonLd;
  try {
    jsonLd = JSON.parse(jsonLdScript);
  } catch (cause) {
    throw new ConversionError('Failed to parse Apple Music song metadata', { cause });
  }
  const title = jsonLd.name;
  const artists = (jsonLd.audio?.byArtist || []).map((a) => a.name).filter(Boolean);
  if (!title) {
    throw new ConversionError('Apple Music metadata missing title');
  }
  return { title, artists };
}

export async function searchSpotify({ title, artists, token, http }) {
  const query = encodeURIComponent(`${title} ${artists.join(',')}`);
  const url = `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`;
  const res = await http.get(url, { headers: { Authorization: `Bearer ${token}` } });
  const items = res.data?.tracks?.items || [];
  if (items.length === 0) return null;
  const spotifyUrl = items[0].external_urls?.spotify;
  if (!spotifyUrl) return null;
  return { spotifyUrl, spotifyUri: spotifyUrlToUri(spotifyUrl) };
}

export function createConverter({
  http = createAxiosHttp(),
  credentials,
  tokenCache = createTokenCache(),
} = {}) {
  if (!credentials?.clientId || !credentials?.clientSecret) {
    throw new Error('Spotify credentials (clientId/clientSecret) are required');
  }

  async function getToken() {
    let token = tokenCache.get();
    if (token) return token;
    token = await getSpotifyToken({ http, credentials });
    tokenCache.set(token);
    return token;
  }

  async function convert(appleLink) {
    const normalized = normalizeAppleLink(appleLink);
    if (!normalized || !isAppleSongUrl(normalized)) {
      return { status: 'invalid' };
    }
    try {
      const token = await getToken();
      const { title, artists } = await getAppleMetadata(normalized, { http });
      const found = await searchSpotify({ title, artists, token, http });
      if (!found) return { status: 'not_found', title, artists };
      return { status: 'ok', title, artists, spotifyUrl: found.spotifyUrl, spotifyUri: found.spotifyUri };
    } catch (err) {
      if (err instanceof ConversionError) throw err;
      throw new ConversionError('Conversion failed', { cause: err });
    }
  }

  return {
    convert,
    // Exposed for tests and diagnostics:
    getToken,
    getSpotifyToken: () => getSpotifyToken({ http, credentials }),
    getAppleMetadata: (link) => getAppleMetadata(link, { http }),
    searchSpotify: (args) => searchSpotify({ ...args, http }),
  };
}
