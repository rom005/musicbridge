import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

function startServer() {
  const listener = {
    getStatus: () => ({
      connection: 'idle',
      qrDataUrl: null,
      selectedGroupId: null,
      selectedGroupName: null,
    }),
    getGroups: async () => [],
    setSelectedGroup: async () => {},
    getErrors: () => [],
  };
  const converter = {
    convert: async () => ({
      status: 'ok',
      title: 'T',
      artists: ['A'],
      spotifyUrl: 'https://open.spotify.com/track/xyz',
      spotifyUri: 'spotify:track:xyz',
    }),
  };
  const config = { sessionSecret: 'secret', adminPassword: 'pw', isProd: false };
  const app = createApp({ listener, converter, config, logger: undefined, adminHtml: '<html>admin-ui</html>' });

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('healthz returns ok', async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await close(server);
  }
});

test('admin page is served without auth', async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/admin`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /admin-ui/);
  } finally {
    await close(server);
  }
});

test('admin API requires auth', async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/api/status`);
    assert.equal(res.status, 401);
  } finally {
    await close(server);
  }
});

test('login rejects a bad password and accepts the correct one', async () => {
  const { server, base } = await startServer();
  try {
    const bad = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    assert.equal(bad.status, 401);

    const good = await fetch(`${base}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'pw' }),
    });
    assert.equal(good.status, 200);
    const setCookie = good.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('mb_session='));

    const status = await fetch(`${base}/api/status`, {
      headers: { cookie: setCookie.split(';')[0] },
    });
    assert.equal(status.status, 200);
  } finally {
    await close(server);
  }
});

test('converter route redirects and handles invalid input', async () => {
  const { server, base } = await startServer();
  try {
    const invalid = await fetch(`${base}/?link=https://example.com/x`, { redirect: 'manual' });
    assert.equal(invalid.status, 400);

    const url = await fetch(`${base}/?link=https://music.apple.com/us/song/x/1`, { redirect: 'manual' });
    assert.equal(url.status, 302);
    assert.equal(url.headers.get('location'), 'https://open.spotify.com/track/xyz');

    const uri = await fetch(`${base}/?link=https://music.apple.com/us/song/x/1&type=uri`, {
      redirect: 'manual',
    });
    assert.equal(uri.status, 302);
    assert.equal(uri.headers.get('location'), 'spotify:track:xyz');
  } finally {
    await close(server);
  }
});
