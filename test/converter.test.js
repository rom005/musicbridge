import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAppleMusicUrl,
  normalizeAppleLink,
  isAppleSongUrl,
  spotifyUrlToUri,
  getAppleMetadata,
  searchSpotify,
  createConverter,
  ConversionError,
} from '../src/converter.js';

// --- URL helpers ---

test('extractAppleMusicUrl finds the first Apple Music URL', () => {
  assert.equal(
    extractAppleMusicUrl('listen: https://music.apple.com/us/song/abc/123456?i=789 thanks'),
    'https://music.apple.com/us/song/abc/123456?i=789'
  );
  assert.equal(
    extractAppleMusicUrl('scheme-less music.apple.com/us/song/x/1'),
    'https://music.apple.com/us/song/x/1'
  );
  assert.equal(extractAppleMusicUrl('no url here'), null);
  assert.equal(extractAppleMusicUrl('https://example.com/foo'), null);
});

test('normalizeAppleLink validates host and scheme', () => {
  assert.ok(normalizeAppleLink('https://music.apple.com/us/song/x/1'));
  assert.ok(normalizeAppleLink('https://geo.music.apple.com/us/song/x/1'));
  assert.equal(normalizeAppleLink('https://evil.com/music.apple.com/x'), null);
  assert.equal(normalizeAppleLink('ftp://music.apple.com/x'), null);
  assert.equal(normalizeAppleLink('not a url'), null);
});

test('isAppleSongUrl', () => {
  assert.ok(isAppleSongUrl('https://music.apple.com/us/song/x/1'));
  assert.ok(isAppleSongUrl('https://music.apple.com/us/album/x/1?i=2'));
  assert.equal(isAppleSongUrl('https://music.apple.com/us/album/x/1'), false);
});

test('spotifyUrlToUri', () => {
  assert.equal(spotifyUrlToUri('https://open.spotify.com/track/abc?si=xyz'), 'spotify:track:abc');
  assert.equal(spotifyUrlToUri('https://open.spotify.com/intl-pt/track/abc'), 'spotify:track:abc');
  assert.equal(spotifyUrlToUri('https://example.com/track/abc'), null);
});

// --- low-level pieces ---

const SONG_HTML =
  '<html><script type="application/ld+json" id="schema:song">' +
  JSON.stringify({ name: 'My Song', audio: { byArtist: [{ name: 'Artist A' }, { name: 'Artist B' }] } }) +
  '</script></html>';

test('getAppleMetadata parses #schema:song', async () => {
  const http = { get: async () => ({ data: SONG_HTML, status: 200 }) };
  assert.deepEqual(await getAppleMetadata('https://music.apple.com/us/song/x/1', { http }), {
    title: 'My Song',
    artists: ['Artist A', 'Artist B'],
  });
});

test('getAppleMetadata throws when #schema:song is missing', async () => {
  const http = { get: async () => ({ data: '<html></html>', status: 200 }) };
  await assert.rejects(
    getAppleMetadata('https://music.apple.com/us/album/x/1', { http }),
    ConversionError
  );
});

test('searchSpotify returns url + uri', async () => {
  const http = {
    get: async () => ({
      data: { tracks: { items: [{ external_urls: { spotify: 'https://open.spotify.com/track/abc' } }] } },
      status: 200,
    }),
  };
  assert.deepEqual(await searchSpotify({ title: 'My Song', artists: ['A'], token: 't', http }), {
    spotifyUrl: 'https://open.spotify.com/track/abc',
    spotifyUri: 'spotify:track:abc',
  });
});

test('searchSpotify returns null when empty', async () => {
  const http = { get: async () => ({ data: { tracks: { items: [] } }, status: 200 }) };
  assert.equal(await searchSpotify({ title: 'My Song', artists: ['A'], token: 't', http }), null);
});

// --- createConverter ---

function fakeHttp({ tracks = [] } = {}) {
  let tokenCalls = 0;
  return {
    tokenCalls: () => tokenCalls,
    async post() {
      tokenCalls += 1;
      return { data: { access_token: 'tok' }, status: 200 };
    },
    async get(url) {
      if (url.includes('api.spotify.com')) {
        return { data: { tracks: { items: tracks } }, status: 200 };
      }
      return { data: SONG_HTML, status: 200 };
    },
  };
}

const CREDS = { clientId: 'id', clientSecret: 'secret' };
const TRACK = [{ external_urls: { spotify: 'https://open.spotify.com/track/abc' } }];

test('convert happy path', async () => {
  const http = fakeHttp({ tracks: TRACK });
  const converter = createConverter({ http, credentials: CREDS });
  const r = await converter.convert('https://music.apple.com/us/song/x/1');
  assert.equal(r.status, 'ok');
  assert.equal(r.spotifyUrl, 'https://open.spotify.com/track/abc');
  assert.equal(r.spotifyUri, 'spotify:track:abc');
  assert.equal(r.title, 'My Song');
});

test('convert returns not_found for empty Spotify results', async () => {
  const converter = createConverter({ http: fakeHttp({ tracks: [] }), credentials: CREDS });
  const r = await converter.convert('https://music.apple.com/us/song/x/1');
  assert.equal(r.status, 'not_found');
});

test('convert returns invalid for non-Apple or non-song URLs', async () => {
  const converter = createConverter({ http: fakeHttp({ tracks: TRACK }), credentials: CREDS });
  assert.equal((await converter.convert('https://example.com/foo')).status, 'invalid');
  assert.equal((await converter.convert('https://music.apple.com/us/album/x/1')).status, 'invalid');
});

test('convert caches the Spotify token', async () => {
  const http = fakeHttp({ tracks: TRACK });
  const converter = createConverter({ http, credentials: CREDS });
  await converter.convert('https://music.apple.com/us/song/x/1');
  await converter.convert('https://music.apple.com/us/song/x/1');
  assert.equal(http.tokenCalls(), 1);
});

test('convert wraps http failures as ConversionError', async () => {
  const http = {
    post: async () => {
      throw new Error('network down');
    },
    get: async () => {
      throw new Error('network down');
    },
  };
  const converter = createConverter({ http, credentials: CREDS });
  await assert.rejects(converter.convert('https://music.apple.com/us/song/x/1'), ConversionError);
});
