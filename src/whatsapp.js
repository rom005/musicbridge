import QRCode from 'qrcode';
import { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Browsers } from './baileys.js';
import { createAuthState } from './auth.js';
import { extractAppleMusicUrl } from './converter.js';
import { createDedupe } from './dedupe.js';

const SELECTED_GROUP_KEY = 'config:selectedGroup';

export function getMessageText(msg) {
  const m = msg?.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  );
}

export function shouldProcessMessage(msg, { selectedGroupId }) {
  if (!msg || !selectedGroupId) return false;
  if (msg.key?.fromMe) return false;
  if (msg.key?.remote !== selectedGroupId) return false;
  return true;
}

export function createWhatsAppListener({ store, converter, logger }) {
  let sock = null;
  let auth = null;
  let connecting = false;
  let stopped = false;
  let reconnectTimer = null;

  let selectedGroupId = null;
  let selectedGroupName = null;
  let qrDataUrl = null;
  let lastQrString = null;
  let jid = null;
  let pushName = null;
  let startedAt = null;
  let connection = 'idle';
  let lastError = null;

  const errors = [];
  const dedupe = createDedupe({ ttlMs: 10 * 60 * 1000, max: 5000 });

  function recordError(message) {
    lastError = message;
    errors.unshift({ at: new Date().toISOString(), message });
    if (errors.length > 50) errors.length = 50;
  }

  function getStatus() {
    return {
      connection,
      qrDataUrl,
      jid,
      pushName,
      selectedGroupId,
      selectedGroupName,
      lastError,
      startedAt,
    };
  }

  function getErrors() {
    return errors.slice();
  }

  async function loadSelectedGroup() {
    selectedGroupId = await store.get(SELECTED_GROUP_KEY);
  }

  function scheduleReconnect(delayMs = 2000) {
    if (stopped) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void start();
    }, delayMs);
  }

  async function handleConnectionUpdate(update) {
    if (update.qr) {
      connection = 'qr';
      if (update.qr !== lastQrString) {
        lastQrString = update.qr;
        try {
          qrDataUrl = await QRCode.toDataURL(update.qr);
        } catch (err) {
          qrDataUrl = null;
          logger?.error?.({ err }, 'qr generation failed');
        }
      }
      return;
    }

    if (update.connection === 'open') {
      connection = 'open';
      qrDataUrl = null;
      lastQrString = null;
      jid = sock?.user?.id || null;
      pushName = sock?.user?.name || null;
      startedAt = new Date().toISOString();
      void refreshGroups().catch((err) => logger?.warn?.({ err }, 'refreshGroups failed'));
      return;
    }

    if (update.connection === 'close') {
      const statusCode = update.lastDisconnect?.error?.output?.statusCode;
      const wasLoggedOut = statusCode === DisconnectReason.loggedOut;

      const oldSock = sock;
      sock = null; // single-socket invariant: clear before any reconnect
      if (oldSock?.ev) {
        try {
          oldSock.ev.removeAllListeners();
        } catch {
          /* ignore */
        }
      }

      if (stopped) {
        connection = 'stopped';
        return;
      }

      if (wasLoggedOut) {
        connection = 'loggedOut';
        qrDataUrl = null;
        lastQrString = null;
        try {
          await auth?.clearAuth?.();
        } catch (err) {
          logger?.error?.({ err }, 'clearAuth failed');
        }
        auth = null;
        scheduleReconnect(1000); // fresh creds -> new QR
      } else {
        connection = 'reconnecting';
        lastError = String(update.lastDisconnect?.error?.message ?? statusCode ?? 'unknown');
        scheduleReconnect(2000);
      }
    }
  }

  async function refreshGroups() {
    if (!sock) return;
    const groups = await sock.groupFetchAllParticipating();
    for (const id in groups) {
      if (id === selectedGroupId) selectedGroupName = groups[id].subject;
    }
  }

  async function start() {
    if (sock || connecting || stopped) return;
    connecting = true;
    try {
      await loadSelectedGroup();
      if (stopped) return;

      auth = await createAuthState({ store, logger });

      let version;
      try {
        ({ version } = await fetchLatestBaileysVersion());
      } catch (err) {
        logger?.warn?.({ err }, 'could not fetch latest baileys version; using bundled default');
      }

      if (stopped) return;
      connection = 'starting';
      sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: auth.state,
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        logger,
      });

      sock.ev.on('creds.update', () => {
        auth.saveCreds().catch((err) => logger?.error?.({ err }, 'creds save failed'));
      });

      sock.ev.on('connection.update', (update) => {
        void handleConnectionUpdate(update);
      });

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          try {
            await processMessage(msg, sock);
          } catch (err) {
            logger?.error?.({ err, id: msg?.key?.id }, 'message processing failed');
          }
        }
      });
    } catch (err) {
      logger?.error?.({ err }, 'whatsapp start failed');
      connection = 'reconnecting';
      scheduleReconnect();
    } finally {
      connecting = false;
    }
  }

  async function processMessage(msg, currentSock) {
    if (!shouldProcessMessage(msg, { selectedGroupId })) return;
    const text = getMessageText(msg);
    if (!text) return;
    const link = extractAppleMusicUrl(text);
    if (!link) return;

    const dedupeKey = `${msg.key.remote}:${msg.key.id}`;
    if (dedupe.has(dedupeKey)) return;
    dedupe.add(dedupeKey);

    let result;
    try {
      result = await converter.convert(link);
    } catch (err) {
      recordError(`Conversion failed: ${err.message}`);
      return; // transient failure -> no reply
    }

    if (result.status === 'ok') {
      await currentSock.sendMessage(msg.key.remote, { text: result.spotifyUrl });
    } else if (result.status === 'not_found') {
      await currentSock.sendMessage(msg.key.remote, {
        text: `Couldn't find "${result.title}" by "${result.artists.join(', ')}" on Spotify.`,
      });
    }
    // 'invalid' -> no reply
  }

  async function getGroups() {
    if (!sock) return [];
    const groups = await sock.groupFetchAllParticipating();
    return Object.entries(groups).map(([id, g]) => ({
      id,
      name: g.subject || id,
      participantCount: g.participants?.length ?? 0,
    }));
  }

  async function setSelectedGroup(id) {
    if (typeof id !== 'string' || !id) throw new Error('invalid group id');
    if (sock) {
      const groups = await sock.groupFetchAllParticipating();
      if (!groups[id]) throw new Error('group not found');
      selectedGroupName = groups[id].subject || id;
    }
    selectedGroupId = id;
    await store.set(SELECTED_GROUP_KEY, id);
  }

  async function stop() {
    stopped = true;
    connection = 'stopped';
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (sock) {
      const s = sock;
      sock = null;
      try {
        s.end(new Error('shutdown')); // do NOT logout: keeps session for next boot
      } catch {
        /* ignore */
      }
    }
  }

  return {
    start,
    stop,
    getStatus,
    getGroups,
    setSelectedGroup,
    getErrors,
    processMessage,
  };
}
