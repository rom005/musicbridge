// @whiskeysockets/baileys is CommonJS whose module.exports is the makeWASocket
// function with the named exports attached as properties. Use a namespace import
// and read the named symbols off it (reliable across Node's CJS/ESM interop).
import * as baileys from '@whiskeysockets/baileys';

export const makeWASocket = baileys.makeWASocket ?? baileys.default;
export const {
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  Browsers,
  BufferJSON,
  proto,
} = baileys;
