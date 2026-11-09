import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import pino from 'pino';
import { loadConfig } from './src/config.js';
import { createStore } from './src/store.js';
import { createConverter } from './src/converter.js';
import { createWhatsAppListener } from './src/whatsapp.js';
import { createApp } from './src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });

  const store = await createStore({
    logger,
    redisUrl: config.redisUrl,
    dataDir: config.dataDir,
  });

  const converter = createConverter({
    credentials: { clientId: config.spotifyClientId, clientSecret: config.spotifyClientSecret },
  });

  const listener = createWhatsAppListener({ store, converter, logger });

  const adminHtml = await readFile(path.join(__dirname, 'src', 'admin.html'), 'utf8');
  const app = createApp({ listener, converter, config, logger, adminHtml });

  const server = app.listen(config.port, config.host, () => {
    logger.info({ port: config.port, host: config.host }, 'MusicBridge listening');
  });

  // The WhatsApp listener starts at boot, independent of HTTP traffic.
  await listener.start();

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const force = setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, 5000);
    force.unref();

    try {
      await listener.stop();
      await new Promise((resolve) => server.close(resolve));
      await store.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'shutdown error');
      process.exit(1);
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
