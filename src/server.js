import express from 'express';
import crypto from 'node:crypto';
import { signSession, verifySession } from './session.js';
import { normalizeAppleLink } from './converter.js';

const COOKIE_NAME = 'mb_session';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (header) {
    for (const pair of header.split(';')) {
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name) out[name] = decodeURIComponent(value);
    }
  }
  return out;
}

export function createApp({ listener, converter, config, logger, adminHtml }) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  function requireAuth(req, res, next) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const payload = verifySession({ secret: config.sessionSecret, token });
    if (!payload) return res.status(401).json({ error: 'unauthorized' });
    req.admin = payload;
    return next();
  }

  // --- public ---

  app.get('/healthz', (req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get('/', async (req, res, next) => {
    const appleLink = req.query.link;
    if (!normalizeAppleLink(appleLink)) {
      return res.status(400).send('Invalid or missing Apple Music link.');
    }
    try {
      const result = await converter.convert(appleLink);
      if (result.status === 'ok') {
        if (req.query.type === 'uri') {
          // Express normalizes a bare `spotify:` Location, so set it explicitly.
          return res.status(302).set('Location', result.spotifyUri).end();
        }
        return res.redirect(result.spotifyUrl);
      }
      if (result.status === 'not_found') {
        return res
          .status(404)
          .send(`Could not find "${result.title}" by "${result.artists.join(', ')}" on Spotify.`);
      }
      return res.status(400).send('Invalid or missing Apple Music link.');
    } catch (err) {
      return next(err);
    }
  });

  // --- admin ---

  app.post('/admin/login', (req, res) => {
    const submitted = typeof req.body?.password === 'string' ? req.body.password : '';
    const a = sha256(submitted);
    const b = sha256(config.adminPassword);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      const token = signSession({ secret: config.sessionSecret, payload: { role: 'admin' } });
      const secure = config.isProd ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax${secure}`);
      return res.status(200).json({ ok: true });
    }
    return res.status(401).json({ error: 'invalid password' });
  });

  app.post('/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
    res.status(200).json({ ok: true });
  });

  app.get('/admin', (req, res) => {
    res.type('html').send(adminHtml);
  });

  // --- authenticated admin API ---

  app.get('/api/status', requireAuth, (req, res) => {
    res.json(listener.getStatus());
  });

  app.get('/api/qr', requireAuth, (req, res) => {
    res.json({ qrDataUrl: listener.getStatus().qrDataUrl || null });
  });

  app.get('/api/groups', requireAuth, async (req, res, next) => {
    try {
      res.json(await listener.getGroups());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/groups/select', requireAuth, async (req, res, next) => {
    const id = req.body?.id;
    if (typeof id !== 'string' || !id) {
      return res.status(400).json({ error: 'id required' });
    }
    try {
      await listener.setSelectedGroup(id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/errors', requireAuth, (req, res) => {
    res.json(listener.getErrors());
  });

  // --- error handler ---
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger?.error?.({ err }, 'request error');
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
