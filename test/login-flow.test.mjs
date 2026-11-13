import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { decryptSession, SESSION_KEY } from '../src/infrastructure/session.mjs';
import { PREFERENCES_KEY } from '../src/infrastructure/preferences.mjs';
import { demo } from '../src/demo.mjs';

globalThis.crypto ??= webcrypto;
// Exercise the real app and encryption with a tiny DOM substitute and a fake
// Telegram transport. These tests do not launch a browser or contact an account.
const compiled = await build({
  entryPoints: ['src/main.mjs'], bundle: true, write: false, platform: 'browser', format: 'iife',
  plugins: [{ name:'fake-telegram', setup(builder) {
    builder.onLoad({ filter:/\/telegram\.mjs$/ }, () => ({ contents: `
      export const createClient = (...args) => hooks.createClient(...args);
      export const auth = {
        sendCode: async () => ({phoneCodeHash:'fake-code-hash', type:'app'}),
        signIn: async () => ({displayName:'Test'}),
        password: async () => ({displayName:'Test'}),
        me: async () => ({displayName:'Test'}),
        logout: async () => { hooks.logouts++; },
      };
      export const explainError = error => error.message;
      export const fetchPolls = (...args) => hooks.fetchPolls(...args);
      export const makeCrypto = () => { throw new Error('Unexpected diagnostics'); };
    `, loader:'js' }));
  } }],
});
const html = await readFile('src/index.html', 'utf8');

class Node {
  constructor(tag = 'div') { this.tag = tag; this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this.open = false; this.children = []; this.handlers = {}; this.attributes = {}; this.classList = {toggle(){}}; }
  addEventListener(type, handler) { (this.handlers[type] ??= []).push(handler); }
  async emit(type) { for (const handler of this.handlers[type] || []) await handler({ preventDefault(){} }); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}
function app(values = new Map(), options = {}) {
  const nodes = new Map();
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = new Node(match[1]); node.hidden = /\bhidden\b/.test(match[2]); node.disabled = /\bdisabled\b/.test(match[2]); node.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] ?? ''; nodes.set(match[3], node);
  }
  const hooks = {
    logouts:0, destroyed:0, imports:[], requests:[],
    async fetchPolls(client, links) {
      hooks.requests.push(links);
      if (!options.pollData) throw new Error('Unexpected poll request');
      return options.pollData;
    },
    createClient(apiId, apiHash) { return {
      async exportSession() { await options.beforeExport?.(); return 'SYNTHETIC_LOGIN_SESSION_SECRET'; },
      async getApiCredentials() { return {id:apiId, hash:apiHash}; },
      async importSession(session) { hooks.imports.push(session); },
      async destroy() { hooks.destroyed++; },
    }; },
  };
  runInNewContext(compiled.outputFiles[0].text, {
    hooks, crypto:webcrypto, TextEncoder, TextDecoder, Uint8Array, WebAssembly, URL, Blob, setTimeout, atob, btoa,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { if (options.denyWrites) throw new Error('denied'); values.set(key, value); },
      removeItem: key => values.delete(key),
    },
    document: { getElementById:id => { assert.ok(nodes.has(id), `Missing DOM element: ${id}`); return nodes.get(id); }, createElement:tag => new Node(tag), createTextNode:text => ({textContent:text}), body:new Node('body') },
  });
  const $ = id => nodes.get(id);
  return { $, values, hooks,
    async login(remember = true) {
      await $('connect').emit('click');
      $('apiId').value = '12345'; $('apiHash').value = 'abcdef0123456789abcdef0123456789'; $('phone').value = '+381123456789'; $('remember').checked = remember;
      await $('loginForm').emit('submit');
      $('code').value = '12345';
      await $('loginForm').emit('submit');
    },
    async save() { $('savePassword').value = $('saveConfirm').value = 'Test1234'; await $('loginForm').emit('submit'); },
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
  for (const id of ['savePassword','saveConfirm','apiId','apiHash','phone','code','password']) assert.equal(first.$(id).value, '');

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

test('global topic filter starts at three, rerenders without Telegram, and disables export when no dates qualify', async () => {
  const view = app();
  assert.equal(view.$('topicMinimum').value, '3');
  await view.$('demo').emit('click');
  assert.equal(view.$('rows').children.length, 2);
  assert.equal(view.$('export').disabled, false);
  view.$('topicMinimum').value = '4';
  await view.$('topicMinimum').emit('input');
  assert.equal(view.$('rows').children.length, 0);
  assert.equal(view.$('export').disabled, true);
  assert.equal(view.$('empty').hidden, false);
  assert.match(view.$('empty').children[0].textContent, /at least 4 people/);
  view.$('topicMinimum').value = '0';
  await view.$('topicMinimum').emit('input');
  assert.equal(view.$('rows').children.length, 2);
  assert.equal(view.$('export').disabled, false);
  assert.equal(app(view.values).$('topicMinimum').value, '0');
});

test('one link submits four inferred polls, persists only manual input, and detects changes to effective links', async () => {
  const view = app(new Map(), {pollData:demo()});
  view.$('link0').value = 'https://t.me/groupchat/123';
  await view.$('link0').emit('input');
  assert.equal(view.$('link1').placeholder, 'https://t.me/groupchat/124');
  assert.equal(view.$('link3').placeholder, 'https://t.me/groupchat/126');
  assert.equal(view.$('clearLinks').hidden, true);
  const reloaded = app(view.values);
  assert.equal(reloaded.$('link3').value, '');
  assert.equal(reloaded.$('link3').placeholder, 'https://t.me/groupchat/126');
  await view.login(false);
  await view.$('pollForm').emit('submit');
  assert.deepEqual(Array.from(view.hooks.requests[0], link => link.messageId), [123, 124, 125, 126]);
  assert.equal(view.$('export').disabled, false);
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
  assert.equal(app(view.values).$('link0').value, '');
});

test('manual overrides restart suggestions; duplicate polls are rejected before login', async () => {
  const view = app();
  view.$('link0').value = 'https://t.me/groupchat/123';
  view.$('link2').value = 'https://t.me/anotherchat/500';
  await view.$('link2').emit('input');
  assert.equal(view.$('link3').placeholder, 'https://t.me/anotherchat/501');
  view.$('link2').value = 'https://telegram.me/GROUPCHAT/123?single';
  await view.$('pollForm').emit('submit');
  assert.match(view.$('status').textContent, /four different/);
  assert.equal(view.$('login').open, false);
});

test('corrupt preferences and denied storage do not prevent use', async () => {
  const corrupt = app(new Map([[PREFERENCES_KEY, '{broken']]));
  assert.equal(corrupt.$('topicMinimum').value, '3');
  const invalid = app(new Map([[PREFERENCES_KEY, '{"links":[1,2,3,4],"topicMinimum":-2}']]));
  assert.equal(invalid.$('link0').value, '');
  assert.equal(invalid.$('topicMinimum').value, '3');
  const denied = app(new Map(), {denyWrites:true});
  denied.$('link0').value = 'https://t.me/groupchat/123';
  await denied.$('link0').emit('input');
  assert.equal(denied.$('link3').placeholder, 'https://t.me/groupchat/126');
  assert.match(denied.$('preferencesHint').textContent, /storage is unavailable/);
});

test('login remains memory-only when saving is declined or storage fails', async () => {
  const memory = app();
  await memory.login(false);
  assert.equal(memory.values.has(SESSION_KEY), false);
  assert.equal(memory.$('login').open, false);
  assert.equal(memory.$('disconnect').hidden, false);

  const denied = app(new Map(), {denyWrites:true});
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
  const values = new Map([[SESSION_KEY, 'damaged-envelope'], ['poll-intersections.preferences.v1', '{"links":["a","b","c","d"],"topicMinimum":3}']]);
  const forgotten = app(values);
  await forgotten.$('connect').emit('click');
  await forgotten.$('forgetSession').emit('click');
  assert.equal(values.has(SESSION_KEY), false);
  assert.ok(values.has('poll-intersections.preferences.v1'));
  assert.equal(forgotten.$('credentials').hidden, false);

  let release;
  const cancelled = app(new Map(), {beforeExport:() => new Promise(resolve => {release=resolve;})});
  await cancelled.login();
  const saving = cancelled.save();
  await cancelled.$('cancelLogin').emit('click');
  release();
  await saving;
  assert.equal(cancelled.values.has(SESSION_KEY), false);
  assert.equal(cancelled.$('connect').hidden, false);
  assert.ok(cancelled.hooks.destroyed > 0);
});
