import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPollForm } from '../src/modules/polls/presentation/form.ts';
import * as preferences from '../src/modules/polls/infrastructure/preferences.ts';
const { PREFERENCES_KEY } = preferences;

afterEach(() => {
  delete globalThis.document;
  delete globalThis.localStorage;
});

function setup(links = ['', '', '', '']) {
  const nodes = new Map();
  const storage = new Map([[PREFERENCES_KEY, JSON.stringify({ links, topicMinimum: 3 })]]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.document = {
    activeElement: null,
    getElementById(id) {
      if (!nodes.has(id))
        nodes.set(id, {
          value: '',
          handlers: {},
          setAttribute() {},
          addEventListener(type, callback) {
            this.handlers[type] = callback;
          },
          focus() {
            document.activeElement = this;
          },
        });
      return nodes.get(id);
    },
  };
  const form = createPollForm({ preferences, onLinksChange() {}, onMinimumChange() {} });
  return { form, storage, $: (id) => nodes.get(id) };
}

test('only valid saved links start collapsed, including inferred links; valid typing keeps fields open', () => {
  for (const links of [
    ['', '', '', ''],
    ['bad', '', '', ''],
    ['https://t.me/groupchat/123', 'https://t.me/groupchat/123', '', ''],
    ['https://t.me/groupchat/2147483647', '', '', ''],
  ]) {
    const view = setup(links);
    assert.equal(view.$('pollLinks').open, true);
    assert.equal(document.activeElement, null);
  }
  const saved = setup(['https://t.me/groupchat/123', '', '', '']);
  assert.equal(saved.$('pollLinks').open, false);
  assert.equal(saved.$('pollLinksCount').textContent, ' · 4 polls');
  const initial = setup();
  initial.$('link0').value = 'https://t.me/groupchat/123';
  initial.$('link0').handlers.input();
  assert.equal(initial.$('pollLinks').open, true);
  assert.deepEqual(Object.keys(JSON.parse(initial.storage.get(PREFERENCES_KEY))).sort(), [
    'links',
    'topicMinimum',
  ]);
});

test('semantic, duplicate and native validation errors reveal the fields; semantic errors focus their field', () => {
  const view = setup(['https://t.me/groupchat/123', '', '', '']);
  view.$('link2').value = 'https://example.com/groupchat/125';
  assert.throws(() => view.form.readLinks(), /Time:/);
  assert.equal(view.$('pollLinks').open, true);
  assert.equal(document.activeElement, view.$('link2'));
  view.$('pollLinks').open = false;
  view.$('link2').value = 'https://t.me/groupchat/123';
  assert.throws(() => view.form.readLinks(), /four different/);
  assert.equal(document.activeElement, view.$('link2'));
  assert.equal(view.$('pollLinks').open, true);
  view.$('pollLinks').open = false;
  view.$('link0').handlers.invalid();
  assert.equal(view.$('pollLinks').open, true);
});

test('clearing opens and focuses the first field; collapsing moves focus out of the hidden fields', () => {
  const view = setup(['https://t.me/groupchat/123', 'https://t.me/groupchat/124', '', '']);
  view.$('pollLinks').open = true;
  view.$('link1').focus();
  view.form.collapse();
  assert.equal(view.$('pollLinks').open, false);
  assert.equal(document.activeElement, view.$('pollLinksToggle'));
  view.$('clearLinks').handlers.click();
  assert.equal(view.$('pollLinks').open, true);
  assert.equal(document.activeElement, view.$('link0'));
  assert.deepEqual(JSON.parse(view.storage.get(PREFERENCES_KEY)).links, ['', '', '', '']);
});

test('form text is parsed before applying the shared numeric preference policy', () => {
  const view = setup();
  for (const [text, expected] of [
    ['', 3],
    [' ', 3],
    ['0', 0],
    ['8', 8],
    ['-1', 3],
    ['2.5', 3],
    ['bad', 3],
  ]) {
    view.$('topicMinimum').value = text;
    assert.equal(view.form.getMinimum(), expected, text);
    view.$('topicMinimum').handlers.change();
    assert.equal(view.$('topicMinimum').value, String(expected));
    assert.equal(JSON.parse(view.storage.get(PREFERENCES_KEY)).topicMinimum, expected);
  }
});

test('the v1 storage schema accepts numeric settings and falls back for incompatible representations', () => {
  const view = setup();
  for (const [value, expected] of [
    [0, 0],
    [8, 8],
    ['8', 3],
    [null, 3],
    [false, 3],
    [-1, 3],
    [2.5, 3],
  ]) {
    view.storage.set(
      PREFERENCES_KEY,
      JSON.stringify({ links: ['', '', '', ''], topicMinimum: value }),
    );
    assert.equal(preferences.readPreferences().topicMinimum, expected, String(value));
  }
});
