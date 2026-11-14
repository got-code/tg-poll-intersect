import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { decryptSession, SESSION_KEY } from '../src/modules/auth/infrastructure/saved-session.ts';
import { PREFERENCES_KEY } from '../src/modules/polls/infrastructure/preferences.ts';
import { demo } from '../src/modules/polls/infrastructure/demo.ts';

globalThis.crypto ??= webcrypto;
const tick = () => new Promise((resolve) => setImmediate(resolve));
// Exercise the real app and encryption with a tiny DOM substitute and a fake
// Telegram transport. These tests do not launch a browser or contact an account.
const compiled = await build({
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'js',
    contents: `
    import { mountTestApp } from './test/fixtures/app.mjs';
    import { PasswordRequiredError } from './src/application/errors.ts';
    hooks.passwordRequired = () => new PasswordRequiredError();
    mountTestApp({
      createClient: (...args) => hooks.createClient(...args),
      auth: {
        sendCode: async () => ({codeToken:'fake-code-hash', delivery:'app'}),
        signIn: async () => ({displayName:'Test'}),
        qr: (...args) => hooks.qr(...args),
        password: (...args) => hooks.password(...args),
        me: async () => ({displayName:'Test'}),
        logout: async () => { hooks.logouts++; },
      },
      fetchPolls: (...args) => hooks.fetchPolls(...args),
    });
  `,
  },
});
const html = await readFile('src/index.html', 'utf8');

class Node {
  constructor(tag = 'div') {
    this.tag = tag;
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.children = [];
    this.handlers = {};
    this.attributes = {};
    this.classList = { toggle() {} };
  }
  addEventListener(type, handler) {
    (this.handlers[type] ??= []).push(handler);
  }
  async emit(type) {
    for (const handler of this.handlers[type] || []) await handler({ preventDefault() {} });
  }
  append(...items) {
    this.children.push(...items);
  }
  prepend(...items) {
    for (const item of items) {
      if (item.parentElement)
        item.parentElement.children = item.parentElement.children.filter((child) => child !== item);
      item.parentElement = this;
    }
    this.children.unshift(...items);
  }
  replaceChildren(...items) {
    this.children = items;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  removeAttribute(key) {
    delete this.attributes[key];
  }
  set src(value) {
    this.attributes.src = value;
  }
  get src() {
    return this.attributes.src;
  }
  contains(node) {
    return node === this || this.children.some((child) => child.contains?.(node));
  }
  focus() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.emit('close');
  }
}
function app(values = new Map(), options = {}) {
  const nodes = new Map();
  const timers = new Map();
  let timerId = 0;
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = new Node(match[1]);
    node.hidden = /\bhidden\b/.test(match[2]);
    node.disabled = /\bdisabled\b/.test(match[2]);
    node.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] ?? '';
    for (const [, name, value] of match[2].matchAll(/\b(aria-[\w-]+)="([^"]*)"/g))
      node.setAttribute(name, value);
    nodes.set(match[3], node);
  }
  const hooks = {
    logouts: 0,
    destroyed: 0,
    imports: [],
    requests: [],
    qrAttempts: [],
    passwords: [],
    qr(client, callbacks) {
      return new Promise((resolve, reject) => {
        hooks.qrAttempts.push({ callbacks, resolve, reject });
        if (!options.ignoreQrAbort)
          callbacks.abortSignal.addEventListener(
            'abort',
            () => reject(callbacks.abortSignal.reason),
            { once: true },
          );
      });
    },
    async password(client, password) {
      hooks.passwords.push(password);
      if (password !== 'correct 2FA') throw new Error('Incorrect two-step verification password.');
      return { displayName: 'Test' };
    },
    async fetchPolls(client, links) {
      hooks.requests.push(links);
      if (!options.pollData) throw new Error('Unexpected poll request');
      return options.pollData;
    },
    createClient(apiId, apiHash) {
      return {
        async exportSession() {
          await options.beforeExport?.();
          return 'SYNTHETIC_LOGIN_SESSION_SECRET';
        },
        async getApiCredentials() {
          return { id: apiId, hash: apiHash };
        },
        async importSession(session) {
          hooks.imports.push(session);
        },
        async destroy() {
          hooks.destroyed++;
        },
      };
    },
  };
  const findNode = (node, id) =>
    node.id === id ? node : node.children?.map((child) => findNode(child, id)).find(Boolean);
  const $ = (id) =>
    nodes.get(id) ?? [...nodes.values()].map((node) => findNode(node, id)).find(Boolean);
  runInNewContext(compiled.outputFiles[0].text, {
    hooks,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    WebAssembly,
    URL,
    Blob,
    AbortController,
    atob,
    btoa,
    setTimeout: (fn, delay) => {
      const id = ++timerId;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (options.denyWrites) throw new Error('denied');
        values.set(key, value);
      },
      removeItem: (key) => values.delete(key),
    },
    document: {
      getElementById: (id) => {
        assert.ok($(id), `Missing DOM element: ${id}`);
        return $(id);
      },
      createElement: (tag) => new Node(tag),
      createTextNode: (text) => ({ textContent: text }),
      body: new Node('body'),
    },
  });
  return {
    $,
    values,
    hooks,
    timers,
    async prepareLogin(method = 'phone', remember = false) {
      await $('connect').emit('click');
      if (method === 'qr') await $('qrLogin').emit('click');
      $('apiId').value = '12345';
      $('apiHash').value = 'abcdef0123456789abcdef0123456789';
      $('remember').checked = remember;
      $('phone').value = method === 'phone' ? '+381123456789' : '';
    },
    async login(remember = true) {
      await this.prepareLogin('phone', remember);
      await $('loginForm').emit('submit');
      $('code').value = '12345';
      await $('loginForm').emit('submit');
    },
    async save() {
      $('savePassword').value = $('saveConfirm').value = 'Test1234';
      await $('loginForm').emit('submit');
    },
  };
}

test('opt-in save, reload, wrong password, unlock and logout', async () => {
  const first = app();
  await first.login();
  assert.equal(first.$('saveFields').hidden, false);
  assert.equal(first.values.has(SESSION_KEY), false);
  await first.save();
  const ciphertext = first.values.get(SESSION_KEY);
  const data = await decryptSession(ciphertext, 'Test1234');
  assert.equal(data.session, 'SYNTHETIC_LOGIN_SESSION_SECRET');
  assert.equal(first.$('login').open, false);
  for (const id of ['savePassword', 'saveConfirm', 'apiId', 'apiHash', 'phone', 'code', 'password'])
    assert.equal(first.$(id).value, '');

  const second = app(first.values);
  assert.equal(second.$('connect').textContent, 'Unlock');
  await second.$('connect').emit('click');
  assert.equal(second.$('unlockLabel').hidden, false);
  second.$('unlockPassword').value = 'wrong password';
  await second.$('loginForm').emit('submit');
  assert.match(second.$('loginStatus').textContent, /Wrong password/);
  assert.equal(second.values.get(SESSION_KEY), ciphertext);
  assert.equal(second.hooks.imports.length, 0);
  second.$('unlockPassword').value = 'Test1234';
  await second.$('loginForm').emit('submit');
  assert.deepEqual(second.hooks.imports, ['SYNTHETIC_LOGIN_SESSION_SECRET']);
  assert.equal(second.hooks.logouts, 0);
  assert.equal(second.values.get(SESSION_KEY), ciphertext);
  await second.$('disconnect').emit('click');
  assert.equal(second.hooks.logouts, 1);
  assert.equal(second.values.has(SESSION_KEY), false);
  assert.equal(second.$('connect').textContent, 'Sign in to Telegram');
});

test('QR login needs API keys but no phone, refreshes the image, then uses encrypted save and unlock', async () => {
  const view = app();
  await view.prepareLogin('qr', true);
  const apiId = view.$('apiId'),
    apiHash = view.$('apiHash');
  await view.$('phoneLogin').emit('click');
  assert.equal(view.$('phone').required, true);
  await view.$('qrLogin').emit('click');
  assert.equal(view.$('apiId'), apiId);
  assert.equal(view.$('apiHash'), apiHash);
  assert.equal(apiId.value, '12345');
  assert.equal(apiHash.value, 'abcdef0123456789abcdef0123456789');
  assert.equal(view.$('remember').checked, true);
  assert.equal(view.$('phoneLabel').hidden, true);
  assert.equal(view.$('phone').required, false);
  assert.equal(view.$('phone').disabled, true);
  assert.equal(view.$('loginSubmit').textContent, 'Show QR code');
  view.$('apiHash').value = '';
  await view.$('loginForm').emit('submit');
  assert.equal(view.hooks.qrAttempts.length, 0);
  assert.match(view.$('loginStatus').textContent, /API/);
  view.$('apiHash').value = 'abcdef0123456789abcdef0123456789';
  const signingIn = view.$('loginForm').emit('submit');
  await tick();
  const attempt = view.hooks.qrAttempts[0];
  assert.equal(view.$('loginSubmit').hidden, true);
  attempt.callbacks.onUrlUpdated(
    'tg://login?token=FIRST_SYNTHETIC_TOKEN',
    new Date(Date.now() + 30000),
  );
  const firstImage = view.$('qrCode').src;
  assert.match(firstImage, /^data:image\/gif;base64,/);
  assert.equal(view.$('qrCode').hidden, false);
  assert.equal(view.timers.size, 1);
  // Expired codes disappear while Telegram is producing a replacement.
  [...view.timers.values()][0].fn();
  assert.equal(view.$('qrCode').src, undefined);
  assert.equal(view.$('qrCode').hidden, true);
  assert.equal(view.timers.size, 0);
  attempt.callbacks.onUrlUpdated(
    'tg://login?token=SECOND_SYNTHETIC_TOKEN',
    new Date(Date.now() + 30000),
  );
  assert.notEqual(view.$('qrCode').src, firstImage);
  attempt.callbacks.onQrScanned();
  assert.equal(view.$('qrCode').src, undefined);
  assert.equal(view.timers.size, 0);
  attempt.resolve({ displayName: 'QR Test' });
  await signingIn;
  assert.equal(view.$('saveFields').hidden, false);
  assert.equal(view.$('qrFields').hidden, true);
  await view.save();
  const saved = view.values.get(SESSION_KEY);
  for (const secret of [
    'SYNTHETIC_LOGIN_SESSION_SECRET',
    'SYNTHETIC_TOKEN',
    'tg://login',
    'abcdef0123456789abcdef0123456789',
  ])
    assert.ok(!saved.includes(secret));
  const reloaded = app(view.values);
  await reloaded.$('connect').emit('click');
  assert.equal(reloaded.$('loginMethods').hidden, true);
  reloaded.$('unlockPassword').value = 'Test1234';
  await reloaded.$('loginForm').emit('submit');
  assert.deepEqual(reloaded.hooks.imports, ['SYNTHETIC_LOGIN_SESSION_SECRET']);
  assert.equal(reloaded.$('login').open, false);
});

test('QR 2FA uses the same pending client and allows retrying an incorrect password', async () => {
  const view = app();
  await view.prepareLogin('qr');
  const signingIn = view.$('loginForm').emit('submit');
  await tick();
  view.hooks.qrAttempts[0].reject(view.hooks.passwordRequired());
  await signingIn;
  assert.equal(view.$('passwordLabel').hidden, false);
  assert.equal(view.$('qrFields').hidden, true);
  assert.equal(view.$('apiHash').value, '');
  assert.equal(view.hooks.destroyed, 0);
  view.$('password').value = 'incorrect';
  await view.$('loginForm').emit('submit');
  assert.match(view.$('loginStatus').textContent, /Incorrect/);
  assert.equal(view.$('password').value, '');
  view.$('password').value = 'correct 2FA';
  await view.$('loginForm').emit('submit');
  assert.deepEqual(view.hooks.passwords, ['incorrect', 'correct 2FA']);
  assert.equal(view.$('login').open, false);
  assert.equal(view.$('disconnect').hidden, false);
  assert.equal(view.values.has(SESSION_KEY), false);
});

test('switching from QR to phone or closing aborts the attempt and ignores late QR results', async () => {
  for (const action of ['phoneLogin', 'cancelLogin']) {
    const view = app(new Map(), { ignoreQrAbort: true });
    await view.prepareLogin('qr');
    const signingIn = view.$('loginForm').emit('submit');
    await tick();
    const attempt = view.hooks.qrAttempts[0];
    attempt.callbacks.onUrlUpdated('tg://login?token=OLD', new Date(Date.now() + 30000));
    await view.$(action).emit('click');
    assert.equal(attempt.callbacks.abortSignal.aborted, true);
    assert.equal(view.hooks.destroyed, 1);
    assert.equal(view.$('qrCode').src, undefined);
    assert.equal(view.timers.size, 0);
    if (action === 'cancelLogin') await view.$('connect').emit('click');
    const heading = view.$('loginHeading').textContent;
    attempt.callbacks.onUrlUpdated('tg://login?token=LATE', new Date(Date.now() + 30000));
    attempt.callbacks.onQrScanned();
    attempt.resolve({ displayName: 'Late user' });
    await signingIn;
    assert.equal(view.$('qrCode').src, undefined);
    assert.equal(view.$('loginHeading').textContent, heading);
    assert.equal(view.$('loginSubmit').disabled, false);
    assert.equal(view.$('disconnect').hidden, true);
    assert.equal(view.values.has(SESSION_KEY), false);
    if (action === 'phoneLogin') {
      assert.equal(view.$('phone').required, true);
      assert.equal(view.$('phone').disabled, false);
      view.$('phone').value = '+381123456789';
      await view.$('loginForm').emit('submit');
      assert.equal(view.$('codeLabel').hidden, false);
    }
  }
});

test('QR network failure clears the code and allows a fresh attempt', async () => {
  const view = app();
  await view.prepareLogin('qr');
  const signingIn = view.$('loginForm').emit('submit');
  await tick();
  const attempt = view.hooks.qrAttempts[0];
  attempt.callbacks.onUrlUpdated('tg://login?token=OLD', new Date(Date.now() + 30000));
  attempt.reject(new Error('Network failed'));
  await signingIn;
  assert.match(view.$('loginStatus').textContent, /Network failed/);
  assert.equal(view.$('credentials').hidden, false);
  assert.equal(view.$('qrCode').src, undefined);
  assert.equal(view.$('loginSubmit').disabled, false);
  assert.equal(view.hooks.destroyed, 1);
  const retry = view.$('loginForm').emit('submit');
  await tick();
  assert.equal(view.hooks.qrAttempts.length, 2);
  await view.$('cancelLogin').emit('click');
  await retry;
  assert.equal(view.values.has(SESSION_KEY), false);
});

test('demo filters rerender without Telegram and never persist temporary view settings', async () => {
  const view = app();
  assert.equal(view.$('minimumParticipants').value, '3');
  await view.$('demo').emit('click');
  assert.equal(view.$('rows').children.length, 10);
  assert.equal(view.$('export').disabled, false);
  assert.equal(view.$('resultMeta').hidden, true);
  assert.equal(view.$('demoLabel').hidden, false);
  assert.equal(view.$('status').textContent, '');
  assert.equal(
    view.$('preferencesHint').textContent,
    'Links and view settings are saved in this browser.',
  );
  view.$('minimumParticipants').value = '11';
  await view.$('minimumParticipants').emit('input');
  assert.equal(view.$('rows').children.length, 0);
  assert.equal(view.$('export').disabled, true);
  assert.equal(view.$('empty').hidden, false);
  assert.match(view.$('empty').children[0].textContent, /participant minimum/);
  view.$('minimumParticipants').value = '0';
  await view.$('minimumParticipants').emit('input');
  assert.equal(view.$('rows').children.length, 10);
  assert.equal(view.$('export').disabled, false);
  assert.equal(view.values.has(PREFERENCES_KEY), false);
  assert.equal(app(view.values).$('minimumParticipants').value, '3');
});

test('settings start expanded for incomplete links and keep manual state during loading and demo', async () => {
  const blank = app();
  const load = blank.$('refresh');
  assert.equal(blank.$('pollLinks').hidden, false);
  assert.equal(load.parentElement, blank.$('pollLoadActions'));
  assert.equal(blank.$('pollLinksToggle').attributes['aria-expanded'], 'true');
  assert.equal(blank.$('viewHelp').tag, 'section');
  await blank.$('pollLinksToggle').emit('click');
  assert.equal(blank.$('pollLinks').hidden, true);
  assert.equal(blank.$('refresh'), load);
  assert.equal(load.parentElement, blank.$('pollActions'));
  assert.equal(blank.$('pollLoadActions').children.includes(load), false);
  assert.equal(blank.$('pollLinksToggle').attributes['aria-expanded'], 'false');
  assert.equal(blank.values.has(PREFERENCES_KEY), false);
  assert.equal(app(blank.values).$('pollLinks').hidden, false);

  const view = app(new Map(), {
    pollData: {
      names: { 1: 'First', 2: 'Second', 3: 'Third' },
      polls: [{ id: 'live:1', options: [{ text: 'Answer', voters: ['1', '2', '3'] }] }],
    },
  });
  view.$('link0').value = 'https://t.me/groupchat/123';
  await view.$('link0').emit('input');
  assert.equal(view.$('pollLinks').hidden, false);
  await view.login(false);
  await view.$('pollForm').emit('submit');
  assert.equal(view.$('pollLinks').hidden, false);
  assert.equal(view.$('refresh').textContent, 'Load polls');
  assert.equal(view.$('refresh').disabled, false);
  const stored = view.values.get(PREFERENCES_KEY);

  await view.$('pollLinksToggle').emit('click');
  assert.equal(view.$('refresh').parentElement, view.$('pollActions'));
  assert.equal(view.$('pollLinks').hidden, true);
  await view.$('pollLinksToggle').emit('click');
  assert.equal(view.$('refresh').parentElement, view.$('pollLoadActions'));
  assert.equal(view.$('groupBy').attributes['aria-describedby'], 'groupByHint');
  assert.equal(view.$('filterBy').attributes['aria-describedby'], 'filterByHint');
  await view.$('demoExample').emit('click');
  assert.equal(view.$('pollLinks').hidden, false);
  assert.equal(view.$('groupBy').value, 'demo:2');
  assert.equal(view.$('filterBy').value, 'poll:demo:1');
  assert.equal(view.$('minimumParticipants').value, '3');
  assert.equal(view.values.get(PREFERENCES_KEY), stored);
  assert.equal(app(view.values).$('pollLinks').hidden, true);
  const emptyLinks = new Map([[PREFERENCES_KEY, JSON.stringify({ links: ['', '', ''] })]]);
  assert.equal(app(emptyLinks).$('pollLinks').hidden, false);
  const invalidLinks = new Map([[PREFERENCES_KEY, JSON.stringify({ links: ['invalid'] })]]);
  assert.equal(app(invalidLinks).$('pollLinks').hidden, false);
});

test('demo presets and edits stay separate from live settings through source edits, reload, failure and return', async () => {
  const data = demo();
  data.polls = data.polls.map((poll, index) => ({
    ...poll,
    id: `live:${index + 1}`,
    title: `Live poll ${index + 1}`,
  }));
  const options = { pollData: data };
  const initial = {
    links: ['https://t.me/groupchat/123', '', '', ''],
    groupBy: 'live:4',
    filterBy: { pollId: 'live:3' },
    minimumParticipants: 2,
  };
  const view = app(new Map([[PREFERENCES_KEY, JSON.stringify(initial)]]), options);
  await view.login(false);
  await view.$('pollForm').emit('submit');
  view.$('groupBy').value = 'live:3';
  await view.$('groupBy').emit('change');
  view.$('filterBy').value = 'poll:live:1';
  await view.$('filterBy').emit('change');
  view.$('minimumParticipants').value = '4';
  await view.$('minimumParticipants').emit('input');
  const live = JSON.parse(view.values.get(PREFERENCES_KEY));
  const stored = view.values.get(PREFERENCES_KEY);
  const preferencesHint = view.$('preferencesHint').textContent;
  assert.equal(view.$('resultMeta').hidden, false);

  await view.$('demo').emit('click');
  assert.equal(view.$('resultMeta').hidden, true);
  assert.equal(view.$('status').textContent, '');
  assert.equal(view.$('preferencesHint').textContent, preferencesHint);
  assert.equal(view.$('groupBy').value, 'demo:2');
  assert.equal(view.$('filterBy').value, 'poll:demo:1');
  assert.equal(view.$('minimumParticipants').value, '3');
  assert.equal(view.$('resultHeading').textContent, 'By “Which date?”');
  view.$('groupBy').value = 'demo:3';
  await view.$('groupBy').emit('change');
  view.$('filterBy').value = 'poll:demo:4';
  await view.$('filterBy').emit('change');
  view.$('minimumParticipants').value = '8';
  await view.$('minimumParticipants').emit('input');
  assert.equal(view.values.get(PREFERENCES_KEY), stored);
  const reloaded = app(view.values);
  assert.equal(reloaded.$('minimumParticipants').value, '4');

  view.$('link0').value = 'https://t.me/groupchat/223';
  await view.$('link0').emit('input');
  const edited = { ...live, links: ['https://t.me/groupchat/223', '', '', ''] };
  assert.deepEqual(JSON.parse(view.values.get(PREFERENCES_KEY)), edited);
  await view.$('demo').emit('click');
  assert.equal(view.$('groupBy').value, 'demo:2');
  assert.equal(view.$('minimumParticipants').value, '3');
  assert.deepEqual(JSON.parse(view.values.get(PREFERENCES_KEY)), edited);

  view.$('minimumParticipants').value = '6';
  await view.$('minimumParticipants').emit('input');
  delete options.pollData;
  await view.$('pollForm').emit('submit');
  assert.match(view.$('status').textContent, /Unexpected poll request/);
  assert.equal(view.$('demoLabel').hidden, false);
  assert.equal(view.$('minimumParticipants').value, '6');
  assert.deepEqual(JSON.parse(view.values.get(PREFERENCES_KEY)), edited);

  options.pollData = data;
  await view.$('pollForm').emit('submit');
  assert.equal(view.$('groupBy').value, live.groupBy);
  assert.equal(view.$('filterBy').value, `poll:${live.filterBy.pollId}`);
  assert.equal(view.$('minimumParticipants').value, String(live.minimumParticipants));
  assert.equal(view.$('demoLabel').hidden, true);
  assert.equal(view.$('resultMeta').hidden, false);
  assert.equal(view.$('preferencesHint').textContent, preferencesHint);
  assert.equal(view.$('resultHeading').textContent, 'By “Live poll 3”');
  assert.deepEqual(JSON.parse(view.values.get(PREFERENCES_KEY)), edited);

  await view.$('demo').emit('click');
  await view.$('disconnect').emit('click');
  assert.equal(view.$('resultMeta').hidden, false);
  assert.equal(view.$('demoLabel').hidden, true);
  assert.equal(view.$('minimumParticipants').value, '4');
  assert.deepEqual(JSON.parse(view.values.get(PREFERENCES_KEY)), edited);
});

test('added rows submit inferred polls, persists only manual input, and detects changes to effective links', async () => {
  const view = app(new Map(), { pollData: demo() });
  for (let i = 1; i < 4; i++) await view.$('addPoll').emit('click');
  view.$('link0').value = 'https://t.me/groupchat/123';
  await view.$('link0').emit('input');
  assert.equal(view.$('link1').placeholder, 'https://t.me/groupchat/124');
  assert.equal(view.$('link3').placeholder, 'https://t.me/groupchat/126');
  assert.equal(view.$('clearLinks').hidden, false);
  const reloaded = app(view.values);
  assert.equal(reloaded.$('link3').value, '');
  assert.equal(reloaded.$('link3').placeholder, 'https://t.me/groupchat/126');
  assert.equal(reloaded.$('pollLinks').hidden, true);
  await view.login(false);
  await view.$('pollForm').emit('submit');
  assert.deepEqual(
    Array.from(view.hooks.requests[0], (link) => link.messageId),
    [123, 124, 125, 126],
  );
  assert.equal(view.$('export').disabled, false);
  assert.equal(view.$('pollLinks').hidden, false);
  // A manual value equal to the automatic one still identifies the same polls.
  view.$('link1').value = 'https://telegram.me/GroupChat/124?single';
  await view.$('link1').emit('input');
  assert.equal(view.$('export').disabled, false);
  assert.equal(view.$('clearLinks').hidden, false);
  view.$('link0').value = 'https://t.me/groupchat/223';
  await view.$('link0').emit('input');
  assert.equal(view.$('export').disabled, true);
  assert.match(view.$('resultMeta').textContent, /Links changed/);
  await view.$('clearLinks').emit('click');
  assert.deepEqual(JSON.parse(view.values.get(PREFERENCES_KEY)).links, ['', '', '', '']);
  assert.equal(view.$('clearLinks').hidden, true);
  assert.equal(view.$('pollLinks').hidden, false);
  assert.equal(app(view.values).$('link0').value, '');
});

test('successful and failed refreshes both preserve the manual settings disclosure state', async () => {
  const options = { pollData: demo() };
  const view = app(new Map(), options);
  for (let i = 1; i < 4; i++) await view.$('addPoll').emit('click');
  view.$('link0').value = 'https://t.me/groupchat/123';
  await view.$('link0').emit('input');
  await view.login(false);
  for (const hidden of [false, true]) {
    if (view.$('pollLinks').hidden !== hidden) await view.$('pollLinksToggle').emit('click');
    await view.$('pollForm').emit('submit');
    assert.equal(view.$('pollLinks').hidden, hidden);
    delete options.pollData;
    await view.$('pollForm').emit('submit');
    assert.equal(view.$('pollLinks').hidden, hidden);
    assert.match(view.$('status').textContent, /Unexpected poll request/);
    options.pollData = demo();
  }
});

test('manual overrides restart suggestions; duplicate polls are rejected before login', async () => {
  const view = app();
  for (let i = 1; i < 4; i++) await view.$('addPoll').emit('click');
  view.$('link0').value = 'https://t.me/groupchat/123';
  view.$('link2').value = 'https://t.me/anotherchat/500';
  await view.$('link2').emit('input');
  assert.equal(view.$('link3').placeholder, 'https://t.me/anotherchat/501');
  view.$('link2').value = 'https://telegram.me/GROUPCHAT/123?single';
  await view.$('pollForm').emit('submit');
  assert.match(view.$('status').textContent, /different poll messages/);
  assert.equal(view.$('login').open, false);
});

test('corrupt preferences and denied storage do not prevent use', async () => {
  const corrupt = app(new Map([[PREFERENCES_KEY, '{broken']]));
  assert.equal(corrupt.$('minimumParticipants').value, '3');
  const invalid = app(new Map([[PREFERENCES_KEY, '{"links":[1,2,3,4],"minimumParticipants":-2}']]));
  assert.equal(invalid.$('link0').value, '');
  assert.equal(invalid.$('minimumParticipants').value, '3');
  const denied = app(new Map(), { denyWrites: true });
  denied.$('link0').value = 'https://t.me/groupchat/123';
  await denied.$('link0').emit('input');
  await denied.$('addPoll').emit('click');
  assert.equal(denied.$('link1').placeholder, 'https://t.me/groupchat/124');
  assert.match(denied.$('preferencesHint').textContent, /storage is unavailable/);
  const preferencesHint = denied.$('preferencesHint').textContent;
  await denied.$('demo').emit('click');
  assert.equal(denied.$('preferencesHint').textContent, preferencesHint);
});

test('login remains memory-only when saving is declined or storage fails', async () => {
  const memory = app();
  await memory.login(false);
  assert.equal(memory.values.has(SESSION_KEY), false);
  assert.equal(memory.$('login').open, false);
  assert.equal(memory.$('disconnect').hidden, false);

  const denied = app(new Map(), { denyWrites: true });
  await denied.login();
  await denied.save();
  assert.equal(denied.$('login').open, true);
  assert.match(denied.$('loginStatus').textContent, /did not allow saving/);
  assert.equal(denied.values.has(SESSION_KEY), false);
  await denied.$('skipSave').emit('click');
  assert.equal(denied.$('login').open, false);
  assert.equal(denied.$('disconnect').hidden, false);
});

test('forgetting only removes encrypted session; cancelled asynchronous saving cannot write later', async () => {
  const values = new Map([
    [SESSION_KEY, 'damaged-envelope'],
    ['poll-intersections.preferences.v1', '{"links":["a","b","c","d"],"minimumParticipants":3}'],
  ]);
  const forgotten = app(values);
  await forgotten.$('connect').emit('click');
  await forgotten.$('forgetSession').emit('click');
  assert.equal(values.has(SESSION_KEY), false);
  assert.ok(values.has('poll-intersections.preferences.v1'));
  assert.equal(forgotten.$('credentials').hidden, false);

  let release;
  const cancelled = app(new Map(), {
    beforeExport: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await cancelled.login();
  const saving = cancelled.save();
  await cancelled.$('cancelLogin').emit('click');
  release();
  await saving;
  assert.equal(cancelled.values.has(SESSION_KEY), false);
  assert.equal(cancelled.$('connect').hidden, false);
  assert.ok(cancelled.hooks.destroyed > 0);
});
