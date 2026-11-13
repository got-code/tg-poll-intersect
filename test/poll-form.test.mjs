import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPollForm } from '../src/ui/poll-form.mjs';
import { PREFERENCES_KEY } from '../src/infrastructure/preferences.mjs';

afterEach(() => { delete globalThis.document; delete globalThis.localStorage; });

function setup(links = ['', '', '', '']) {
  const nodes = new Map();
  const storage = new Map([[PREFERENCES_KEY, JSON.stringify({links, topicMinimum:3})]]);
  globalThis.localStorage = {
    getItem:key => storage.get(key) ?? null,
    setItem:(key, value) => storage.set(key, value),
  };
  globalThis.document = {activeElement:null, getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {
      value:'', handlers:{}, setAttribute() {},
      addEventListener(type, callback) { this.handlers[type] = callback; },
      focus() { document.activeElement = this; },
    });
    return nodes.get(id);
  }};
  const form = createPollForm({onLinksChange() {}, onMinimumChange() {}});
  return {form, storage, $:id => nodes.get(id)};
}

test('only valid saved links start collapsed, including inferred links; valid typing keeps fields open', () => {
  for (const links of [
    ['', '', '', ''], ['bad', '', '', ''],
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
  assert.deepEqual(Object.keys(JSON.parse(initial.storage.get(PREFERENCES_KEY))).sort(), ['links', 'topicMinimum']);
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
