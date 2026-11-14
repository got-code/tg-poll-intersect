import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { groupByDate } from '../src/domain/polls.ts';
import { parseLink } from '../src/domain/links.ts';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('@mtcute/wasm/mtcute.wasm', {
  paths: [require.resolve('@mtcute/web')],
});
const sdkFixtureOrigin = 'https://telegram-fixture.invalid/';
const wasmFixtures = new Map(
  await Promise.all(
    ['mtcute.wasm', 'mtcute-simd.wasm'].map(async (name) => [
      sdkFixtureOrigin + name,
      await readFile(
        require.resolve(`@mtcute/wasm/${name}`, { paths: [require.resolve('@mtcute/web')] }),
      ),
    ]),
  ),
);
mock.method(globalThis, 'fetch', async (input) => {
  const bytes = wasmFixtures.get(String(input));
  assert.ok(bytes, `Unexpected network request in SDK test: ${String(input)}`);
  return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
});
after(() => mock.restoreAll());
const result = await build({
  stdin: {
    contents: `
  export * from './src/infrastructure/telegram/client.ts';
  export * from './src/infrastructure/telegram/auth.ts';
  export * from './src/infrastructure/telegram/polls.ts';
  export { BaseTelegramClient } from '@mtcute/web';
  export { writeStringSession } from '@mtcute/web/utils.js';
`,
    resolveDir: process.cwd(),
    loader: 'js',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  define: { 'import.meta.url': JSON.stringify(sdkFixtureOrigin + 'sdk.js') },
});
const script = result.outputFiles[0].text;
globalThis.crypto ??= webcrypto;
const adapter = await import(
  'data:text/javascript;base64,' + Buffer.from(script).toString('base64')
);
const wasm = new WebAssembly.Module(await readFile(wasmPath));
await adapter.makeCrypto(wasm).initialize();

test('SDK WASM and WebCrypto initialize from an offline fixture; SHA-256 matches independent implementation', async () => {
  const crypto = adapter.makeCrypto(wasm);
  await crypto.initialize();
  const data = new TextEncoder().encode('cryptography check');
  assert.equal(
    Buffer.from(crypto.sha256(data)).toString('hex'),
    createHash('sha256').update(data).digest('hex'),
  );
  const random = new Uint8Array(32);
  crypto.randomFill(random);
  assert.ok(random.some(Boolean));
  const key = await crypto.pbkdf2(data, new Uint8Array(16), 10, 32, 'sha256');
  assert.equal(key.length, 32);
});

test('the static build contains local JS, CSS, WASM and dependency licenses with an enforced CSP', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  assert.ok(html.includes("script-src 'self' 'wasm-unsafe-eval'"));
  assert.ok(html.includes("connect-src 'self'"));
  assert.ok(!/__APP_SCRIPT__|__APP_STYLE__|__WASM_BASE64__|__SCRIPT_HASH__/.test(html));
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(!/club-polls|club-demo|club-results|[А-Яа-яЁё]/i.test(html));
  assert.ok(!/<(?:script|link)[^>]+(?:src|href)="https?:|<iframe/i.test(html));
  const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(assets.some((path) => path.endsWith('.js')));
  assert.ok(assets.some((path) => path.endsWith('.css')));
  for (const asset of assets) assert.ok((await readFile(join('dist', asset))).length > 0);
  const wasmAssets = (await readdir('dist/assets')).filter((path) => path.endsWith('.wasm'));
  assert.ok(wasmAssets.length > 0);
  for (const asset of wasmAssets) {
    const bytes = await readFile(join('dist/assets', asset));
    assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
    // The SDK selects SIMD only on capable runtimes; this runner supports the fallback.
    if (!asset.includes('-simd-')) await WebAssembly.compile(bytes);
  }
  const licenses = await readFile('dist/THIRD-PARTY-LICENSES.txt', 'utf8');
  for (const name of ['@mtcute/web', '@mtcute/core', '@mtcute/wasm', 'qr'])
    assert.ok(licenses.includes(name), name);
  assert.ok(licenses.includes('Apache License'));
});

test('actual SDK restores an exported session offline using memory storage, even with localStorage denied', async () => {
  const dc = { id: 2, ipAddress: '149.154.167.51', port: 443 };
  const session = adapter.writeStringSession({
    version: 3,
    primaryDcs: { main: dc, media: dc },
    self: { userId: 123, isBot: false },
    authKey: new Uint8Array(256).fill(42),
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('Storage denied');
    },
  });
  globalThis.navigator ??= {};
  const client = adapter.createClient(12345, 'abcdef0123456789abcdef0123456789');
  try {
    await client.importSession(session);
    assert.equal(await client.exportSession(), session);
    assert.deepEqual(await client.getApiCredentials(), {
      id: 12345,
      hash: 'abcdef0123456789abcdef0123456789',
    });
    assert.equal(client.isConnected, false);
  } finally {
    await client.destroy();
    delete globalThis.localStorage;
  }
});

test('actual SDK send-code response passes through client diagnostics without exposing secrets', async () => {
  const originalCall = adapter.BaseTelegramClient.prototype.call;
  const originalInfo = console.info;
  const entries = [];
  let request;
  console.info = (...args) => entries.push(args);
  adapter.BaseTelegramClient.prototype.call = async (method) => {
    request = method;
    return {
      _: 'auth.sentCode',
      type: { _: 'auth.sentCodeTypeApp', length: 5 },
      nextType: { _: 'auth.codeTypeSms' },
      timeout: 60,
      phoneCodeHash: 'SECRET_PHONE_CODE_HASH',
    };
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
    for (const secret of [
      '381123456789',
      'abcdef0123456789abcdef0123456789',
      'SECRET_PHONE_CODE_HASH',
      '12345',
    ]) {
      assert.ok(!logs.includes(secret));
    }
  } finally {
    adapter.BaseTelegramClient.prototype.call = originalCall;
    console.info = originalInfo;
    await client.destroy();
  }
});

test('actual SDK QR flow refreshes expired tokens, accepts updates without enabling chat updates, and migrates DC', async () => {
  globalThis.navigator ??= {};
  const client = adapter.createClient(12345, 'abcdef0123456789abcdef0123456789', { qrLogin: true });
  const requests = [],
    urls = [],
    migrations = [],
    users = [];
  const user = { _: 'user', id: 123, firstName: 'QR user', self: true };
  let exports = 0,
    scanned = 0;
  client.call = async (request) => {
    requests.push(request);
    if (request._ === 'auth.exportLoginToken') {
      exports++;
      if (exports <= 2)
        return {
          _: 'auth.loginToken',
          token: new Uint8Array([exports, 255]),
          expires: Math.floor(Date.now() / 1000) + (exports === 1 ? -1 : 30),
        };
      return { _: 'auth.loginTokenMigrateTo', dcId: 4, token: new Uint8Array([42]) };
    }
    if (request._ === 'auth.importLoginToken')
      return { _: 'auth.loginTokenSuccess', authorization: { _: 'auth.authorization', user } };
    if (request._ === 'users.getUsers') return [user];
    throw new Error(`Unexpected request: ${request._}`);
  };
  client.changePrimaryDc = async (dc) => migrations.push(dc);
  client.notifyLoggedIn = async (value) => {
    users.push(value);
    return value;
  };
  try {
    assert.equal(client.updates, undefined);
    assert.equal(client.params.disableUpdates, false);
    const signedIn = await adapter.auth.qr(client, {
      onUrlUpdated(url, expires) {
        urls.push([url, expires]);
        if (urls.length === 2)
          queueMicrotask(() =>
            client.onServerUpdate.emit({ _: 'updateShort', update: { _: 'updateLoginToken' } }),
          );
      },
      onQrScanned() {
        scanned++;
      },
    });
    assert.equal(signedIn.displayName, 'QR user');
    assert.deepEqual(
      urls.map(([url]) => url),
      ['tg://login?token=Af8', 'tg://login?token=Av8'],
    );
    assert.ok(urls.every(([, expires]) => expires instanceof Date));
    assert.deepEqual(migrations, [4]);
    assert.deepEqual(users, [user]);
    assert.equal(scanned, 1);
    assert.equal(client.onServerUpdate.length, 0);
    assert.deepEqual(
      requests.map((request) => request._),
      [
        'auth.exportLoginToken',
        'auth.exportLoginToken',
        'auth.exportLoginToken',
        'auth.importLoginToken',
        'users.getUsers',
      ],
    );
    assert.equal(requests[0].apiId, 12345);
    assert.equal(requests[0].apiHash, 'abcdef0123456789abcdef0123456789');
  } finally {
    await client.destroy();
  }
});

test('actual SDK QR flow propagates 2FA and aborts cleanly without leaving an update listener', async () => {
  for (const mode of ['2fa', 'abort']) {
    const client = adapter.createClient(12345, 'abcdef0123456789abcdef0123456789');
    const controller = new AbortController();
    const error = new Error(mode === '2fa' ? 'SESSION_PASSWORD_NEEDED' : 'Cancelled QR login');
    client.call = async () => {
      if (mode === '2fa') throw error;
      return {
        _: 'auth.loginToken',
        token: new Uint8Array([1]),
        expires: Math.floor(Date.now() / 1000) + 30,
      };
    };
    try {
      await assert.rejects(
        adapter.auth.qr(client, {
          abortSignal: controller.signal,
          onUrlUpdated() {
            queueMicrotask(() => controller.abort(error));
          },
        }),
        (value) => value === error,
      );
      assert.equal(client.onServerUpdate.length, 0);
    } finally {
      await client.destroy();
    }
  }
});

function fakeTelegram({
  incomplete = false,
  change = false,
  anonymous = false,
  multipleOptions = false,
  asChat = false,
} = {}) {
  let getMessagesCalls = 0,
    voterCalls = 0;
  const option = new Uint8Array([0]);
  return {
    storage: {
      peers: {
        getByUsername: async () => ({ _: 'inputPeerChannel', channelId: 10, accessHash: 123 }),
      },
    },
    async call(request) {
      if (request._ === 'channels.getMessages') {
        getMessagesCalls++;
        const id = request.id[0].id;
        return {
          _: 'messages.channelMessages',
          users: [],
          chats: [],
          messages: [
            {
              _: 'message',
              id,
              peerId: { _: 'peerChannel', channelId: 10 },
              message: '',
              date: 1,
              media: {
                _: 'messageMediaPoll',
                poll: {
                  _: 'poll',
                  id,
                  publicVoters: !anonymous,
                  question: { text: `Poll ${id}`, entities: [] },
                  answers: [option, ...(multipleOptions ? [new Uint8Array([1])] : [])].map(
                    (option) => ({
                      _: 'pollAnswer',
                      text: { text: 'Option', entities: [] },
                      option,
                    }),
                  ),
                },
                results: {
                  _: 'pollResults',
                  totalVoters: 2,
                  results: [option, ...(multipleOptions ? [new Uint8Array([1])] : [])].map(
                    (option) => ({
                      _: 'pollAnswerVoters',
                      option,
                      voters: change && getMessagesCalls > 4 ? 3 : 2,
                    }),
                  ),
                },
              },
            },
          ],
        };
      }
      if (request._ === 'messages.getPollVotes') {
        voterCalls++;
        const userId = request.offset ? 2 : 1;
        const peer =
          asChat && userId === 2 ? { _: 'peerChannel', channelId: 2 } : { _: 'peerUser', userId };
        return {
          count: 2,
          users: [{ _: 'user', id: userId, firstName: 'Same name' }],
          chats: [{ _: 'channel', id: 2, title: 'Group voter' }],
          votes: [
            {
              _: 'messagePeerVoteInputOption',
              peer,
              date: Date.UTC(2026, 10, 12, 8) / 1000 + userId + request.option[0] * 60,
            },
          ],
          nextOffset: !request.offset && !incomplete ? 'second-page' : '',
        };
      }
      throw new Error(`Unexpected mutation/request: ${request._}`);
    },
    get voterCalls() {
      return voterCalls;
    },
  };
}
const links = [1, 2, 3, 4].map((id) => parseLink(`https://t.me/groupchat/${id}`));

test('Telegram adapter reads four real TL-shaped poll fixtures, pages voters, keeps IDs distinct', async () => {
  const client = fakeTelegram();
  const data = await adapter.fetchPolls(client, links, () => {});
  assert.equal(client.voterCalls, 8);
  assert.equal(data.polls.length, 4);
  assert.equal(Object.keys(data.names).length, 2);
  assert.equal(data.polls[0].votedAt['user:1'], Date.UTC(2026, 10, 12, 8) / 1000 + 1);
  const [group] = groupByDate(data.polls);
  assert.equal(group.ids.length, 2);
  assert.ok(group.sections.every((section) => section.options[0].ids.length === 2));
});

test('Telegram adapter carries vote times for user and chat voters and merges multiple choices by latest time', async () => {
  const data = await adapter.fetchPolls(
    fakeTelegram({ multipleOptions: true, asChat: true }),
    links,
    () => {},
  );
  assert.equal(data.polls[0].options.length, 2);
  assert.equal(data.names['peerChannel:2'], 'Group voter');
  for (const poll of data.polls) {
    assert.equal(poll.votedAt['user:1'], Date.UTC(2026, 10, 12, 8) / 1000 + 61);
    assert.equal(poll.votedAt['peerChannel:2'], Date.UTC(2026, 10, 12, 8) / 1000 + 62);
  }
  const [group] = groupByDate(data.polls);
  assert.equal(group.votesByPerson['peerChannel:2'].length, 4);
  assert.ok(
    group.votesByPerson['peerChannel:2'].every(
      (vote) => vote.voted && vote.at === Date.UTC(2026, 10, 12, 8) / 1000 + 62,
    ),
  );
});

test('adapter rejects partial and changing polls, refuses anonymous polls before fetching voters', async () => {
  await assert.rejects(
    adapter.fetchPolls(fakeTelegram({ incomplete: true }), links, () => {}),
    /incomplete/,
  );
  await assert.rejects(
    adapter.fetchPolls(fakeTelegram({ change: true }), links, () => {}),
    /changed/,
  );
  const anon = fakeTelegram({ anonymous: true });
  await assert.rejects(
    adapter.fetchPolls(anon, links, () => {}),
    /anonymous/,
  );
  assert.equal(anon.voterCalls, 0);
});

test('private links resolve through actual SDK dialog peers when the access hash is not cached', async () => {
  const client = fakeTelegram();
  client.storage.peers.getById = async () => undefined;
  client.storage.peers.getCompleteById = async () => undefined;
  const originalCall = client.call;
  let dialogCalls = 0;
  client.call = async (request) => {
    if (request._ === 'channels.getChannels') return { _: 'messages.chats', chats: [] };
    if (request._ === 'messages.getDialogs') {
      dialogCalls++;
      return {
        _: 'messages.dialogs',
        users: [],
        messages: [],
        chats: [{ _: 'channel', id: 10, accessHash: 123, title: 'Private group', megagroup: true }],
        dialogs: [{ _: 'dialog', peer: { _: 'peerChannel', channelId: 10 }, topMessage: 0 }],
      };
    }
    return originalCall(request);
  };
  const privateLinks = [1, 2, 3, 4].map((id) => parseLink(`https://t.me/c/10/${id}`));
  const data = await adapter.fetchPolls(client, privateLinks, () => {});
  assert.equal(data.polls.length, 4);
  assert.equal(dialogCalls, 4);
  assert.equal(client.voterCalls, 8);
});
