import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppListener, getMessageText, shouldProcessMessage } from '../src/whatsapp.js';

function fakeStore() {
  const data = new Map();
  const get = async (k) => (data.has(k) ? data.get(k) : null);
  const set = async (k, v) => {
    data.set(k, v);
  };
  const del = async (k) => {
    data.delete(k);
  };
  return {
    get,
    set,
    delete: del,
    deleteByPrefix: async () => {},
    getJSON: async (k) => {
      const v = await get(k);
      return v == null ? null : JSON.parse(v);
    },
    setJSON: async (k, v) => set(k, JSON.stringify(v)),
    close: async () => {},
  };
}

function fakeConverter() {
  return {
    async convert(link) {
      if (link.includes('notfound')) return { status: 'not_found', title: 'T', artists: ['A'] };
      if (link.includes('boom')) throw new Error('boom');
      return {
        status: 'ok',
        title: 'T',
        artists: ['A'],
        spotifyUrl: 'https://open.spotify.com/track/xyz',
        spotifyUri: 'spotify:track:xyz',
      };
    },
  };
}

function fakeSock() {
  const sent = [];
  return {
    sent,
    async sendMessage(jid, content) {
      sent.push({ jid, content });
    },
  };
}

function makeMsg({ remote, id, fromMe = false, text }) {
  return { key: { remote, id, fromMe }, message: { conversation: text } };
}

test('getMessageText extracts text from common shapes', () => {
  assert.equal(getMessageText({ message: { conversation: 'hi' } }), 'hi');
  assert.equal(getMessageText({ message: { extendedTextMessage: { text: 'hi2' } } }), 'hi2');
  assert.equal(getMessageText({ message: { imageMessage: { caption: 'cap' } } }), 'cap');
  assert.equal(getMessageText({ message: {} }), '');
  assert.equal(getMessageText(null), '');
});

test('shouldProcessMessage filters by group and own messages', () => {
  const msg = makeMsg({ remote: 'g@g.us', id: '1', text: 'x' });
  assert.equal(shouldProcessMessage(msg, { selectedGroupId: 'g@g.us' }), true);
  assert.equal(shouldProcessMessage(msg, { selectedGroupId: 'other@g.us' }), false);
  assert.equal(
    shouldProcessMessage(makeMsg({ remote: 'g@g.us', id: '2', fromMe: true, text: 'x' }), {
      selectedGroupId: 'g@g.us',
    }),
    false
  );
  assert.equal(shouldProcessMessage(msg, { selectedGroupId: null }), false);
});

test('processMessage replies with the Spotify URL on success', async () => {
  const listener = createWhatsAppListener({ store: fakeStore(), converter: fakeConverter() });
  await listener.setSelectedGroup('g@g.us');
  const sock = fakeSock();
  await listener.processMessage(
    makeMsg({ remote: 'g@g.us', id: '1', text: 'https://music.apple.com/us/song/x/1' }),
    sock
  );
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].jid, 'g@g.us');
  assert.equal(sock.sent[0].content.text, 'https://open.spotify.com/track/xyz');
});

test('processMessage dedupes the same message id', async () => {
  const listener = createWhatsAppListener({ store: fakeStore(), converter: fakeConverter() });
  await listener.setSelectedGroup('g@g.us');
  const sock = fakeSock();
  const msg = makeMsg({ remote: 'g@g.us', id: '1', text: 'https://music.apple.com/us/song/x/1' });
  await listener.processMessage(msg, sock);
  await listener.processMessage(msg, sock);
  assert.equal(sock.sent.length, 1);
});

test('processMessage ignores own messages, other groups, and non-URL text', async () => {
  const listener = createWhatsAppListener({ store: fakeStore(), converter: fakeConverter() });
  await listener.setSelectedGroup('g@g.us');
  const sock = fakeSock();

  await listener.processMessage(
    makeMsg({ remote: 'g@g.us', id: '1', fromMe: true, text: 'https://music.apple.com/us/song/x/1' }),
    sock
  );
  await listener.processMessage(
    makeMsg({ remote: 'other@g.us', id: '2', text: 'https://music.apple.com/us/song/x/1' }),
    sock
  );
  await listener.processMessage(makeMsg({ remote: 'g@g.us', id: '3', text: 'hello world' }), sock);

  assert.equal(sock.sent.length, 0);
});

test('processMessage replies with a not-found message when Spotify has no match', async () => {
  const listener = createWhatsAppListener({ store: fakeStore(), converter: fakeConverter() });
  await listener.setSelectedGroup('g@g.us');
  const sock = fakeSock();
  await listener.processMessage(
    makeMsg({ remote: 'g@g.us', id: '1', text: 'https://music.apple.com/us/song/notfound/1' }),
    sock
  );
  assert.equal(sock.sent.length, 1);
  assert.match(sock.sent[0].content.text, /Couldn't find/);
});

test('processMessage does not reply on conversion error and records it', async () => {
  const listener = createWhatsAppListener({ store: fakeStore(), converter: fakeConverter() });
  await listener.setSelectedGroup('g@g.us');
  const sock = fakeSock();
  await listener.processMessage(
    makeMsg({ remote: 'g@g.us', id: '1', text: 'https://music.apple.com/us/song/boom/1' }),
    sock
  );
  assert.equal(sock.sent.length, 0);
  assert.equal(listener.getErrors().length, 1);
});
