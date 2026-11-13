import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { groupByDate } from '../src/domain/polls.mjs';
import { parseLink } from '../src/domain/links.mjs';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('@mtcute/wasm/mtcute.wasm', { paths: [require.resolve('@mtcute/web')] });
const result = await build({ stdin: { contents: 'export * from "./src/infrastructure/telegram.mjs"; export { BaseTelegramClient } from "@mtcute/web"; export { writeStringSession } from "@mtcute/web/utils.js";', resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm', define: {'import.meta.url': '""'} });
const script = result.outputFiles[0].text.replace('__WASM_BASE64__', (await readFile(wasmPath)).toString('base64'));
globalThis.crypto ??= webcrypto;
const adapter = await import('data:text/javascript;base64,' + Buffer.from(script).toString('base64'));

test('embedded WASM and WebCrypto initialize offline, SHA-256 matches independent implementation', async () => {
  const crypto = adapter.makeCrypto();
  await crypto.initialize();
  const data = new TextEncoder().encode('cryptography check');
  assert.equal(Buffer.from(crypto.sha256(data)).toString('hex'), createHash('sha256').update(data).digest('hex'));
  const random = new Uint8Array(32);
  crypto.randomFill(random);
  assert.ok(random.some(Boolean));
  const key = await crypto.pbkdf2(data, new Uint8Array(16), 10, 32, 'sha256');
  assert.equal(key.length, 32);
});

test('final HTML has valid script hash, embedded licenses, no external resources or unfilled markers', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const app = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(app).digest('base64');
  assert.ok(html.includes(`'sha256-${hash}'`));
  assert.ok(!/__APP_SCRIPT__|__APP_STYLE__|__WASM_BASE64__|__SCRIPT_HASH__/.test(html));
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(!/club-polls|club-demo|club-results|[А-Яа-яЁё]/i.test(html));
  assert.ok(!/<script[^>]+src=|<link[^>]+href=|<iframe/i.test(html));
  assert.ok(html.includes('Third-party components bundled'));
  assert.ok(html.includes('Apache License'));
});

test('actual SDK restores an exported session offline using memory storage, even with localStorage denied', async () => {
  const dc = { id: 2, ipAddress: '149.154.167.51', port: 443 };
  const session = adapter.writeStringSession({ version: 3, primaryDcs: {main:dc, media:dc}, self: {userId:123, isBot:false}, authKey: new Uint8Array(256).fill(42) });
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, get() { throw new Error('Storage denied'); } });
  globalThis.navigator ??= {};
  const client = adapter.createClient(12345, 'abcdef0123456789abcdef0123456789');
  try {
    await client.importSession(session);
    assert.equal(await client.exportSession(), session);
    assert.deepEqual(await client.getApiCredentials(), {id:12345, hash:'abcdef0123456789abcdef0123456789'});
    assert.equal(client.isConnected, false);
  } finally { await client.destroy(); delete globalThis.localStorage; }
});

test('actual SDK send-code response passes through client diagnostics without exposing secrets', async () => {
  const originalCall = adapter.BaseTelegramClient.prototype.call;
  const originalInfo = console.info;
  const entries = [];
  let request;
  console.info = (...args) => entries.push(args);
  adapter.BaseTelegramClient.prototype.call = async method => {
    request = method;
    return { _: 'auth.sentCode', type: { _: 'auth.sentCodeTypeApp', length: 5 },
      nextType: { _: 'auth.codeTypeSms' }, timeout: 60, phoneCodeHash: 'SECRET_PHONE_CODE_HASH' };
  };
  const client = adapter.createClient(12345, 'abcdef0123456789abcdef0123456789');
  try {
    const sent = await adapter.auth.sendCode(client, '+381 123 456 789');
    assert.equal(request._, 'auth.sendCode');
    assert.equal(request.phoneNumber, '381123456789');
    assert.equal(sent.type, 'app');
    assert.equal(sent.nextType, 'sms');
    assert.equal(sent.timeout, 60);
    const logs = JSON.stringify(entries);
    assert.ok(logs.includes('auth.sentCodeTypeApp'));
    assert.ok(logs.includes('auth.codeTypeSms'));
    for (const secret of ['381123456789', 'abcdef0123456789abcdef0123456789', 'SECRET_PHONE_CODE_HASH', '12345']) {
      assert.ok(!logs.includes(secret));
    }
  } finally {
    adapter.BaseTelegramClient.prototype.call = originalCall;
    console.info = originalInfo;
    await client.destroy();
  }
});

function fakeTelegram({ incomplete = false, change = false, anonymous = false } = {}) {
  let getMessagesCalls = 0, voterCalls = 0;
  const option = new Uint8Array([0]);
  return {
    storage: { peers: { getByUsername: async () => ({ _: 'inputPeerChannel', channelId: 10, accessHash: 123 }) } },
    async call(request) {
      if (request._ === 'channels.getMessages') {
        getMessagesCalls++;
        const id = request.id[0].id;
        return {
          _: 'messages.channelMessages', users: [], chats: [],
          messages: [{
            _: 'message', id, peerId: { _: 'peerChannel', channelId: 10 }, message: '', date: 1,
            media: {
              _: 'messageMediaPoll',
              poll: { _: 'poll', id, publicVoters: !anonymous, question: {text: `Poll ${id}`, entities: []}, answers: [{ _: 'pollAnswer', text: {text: 'Option', entities: []}, option }] },
              results: { _: 'pollResults', totalVoters: 2, results: [{ _: 'pollAnswerVoters', option, voters: change && getMessagesCalls > 4 ? 3 : 2 }] },
            },
          }],
        };
      }
      if (request._ === 'messages.getPollVotes') {
        voterCalls++;
        const userId = request.offset ? 2 : 1;
        return { count: 2, users: [{ _: 'user', id: userId, firstName: 'Same name' }], chats: [], votes: [{ _: 'messagePeerVote', peer: { _: 'peerUser', userId }, option }], nextOffset: !request.offset && !incomplete ? 'second-page' : '' };
      }
      throw new Error(`Unexpected mutation/request: ${request._}`);
    },
    get voterCalls() { return voterCalls; },
  };
}
const links = [1,2,3,4].map(id => parseLink(`https://t.me/groupchat/${id}`));

test('Telegram adapter reads four real TL-shaped poll fixtures, pages voters, keeps IDs distinct', async () => {
  const client = fakeTelegram();
  const data = await adapter.fetchPolls(client, links, () => {});
  assert.equal(client.voterCalls, 8);
  assert.equal(data.polls.length, 4);
  assert.equal(Object.keys(data.names).length, 2);
  const [group] = groupByDate(data.polls);
  assert.equal(group.ids.length, 2);
  assert.ok(group.sections.every(section => section.options[0].ids.length === 2));
});

test('adapter rejects partial and changing polls, refuses anonymous polls before fetching voters', async () => {
  await assert.rejects(adapter.fetchPolls(fakeTelegram({incomplete:true}), links, () => {}), /incomplete/);
  await assert.rejects(adapter.fetchPolls(fakeTelegram({change:true}), links, () => {}), /changed/);
  const anon = fakeTelegram({anonymous:true});
  await assert.rejects(adapter.fetchPolls(anon, links, () => {}), /anonymous/);
  assert.equal(anon.voterCalls, 0);
});
