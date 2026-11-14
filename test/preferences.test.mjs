import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as preferences from '../src/modules/polls/infrastructure/preferences.ts';
import {
  defaultPreferences,
  resolveParticipantMinimum,
} from '../src/modules/polls/application/preferences.ts';

const { PREFERENCES_KEY } = preferences;
afterEach(() => {
  delete globalThis.localStorage;
});
function storage(value) {
  const values = new Map(value === undefined ? [] : [[PREFERENCES_KEY, value]]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  return values;
}

test('settings default to one poll, filtering by grouping and three participants', () => {
  storage();
  assert.deepEqual(preferences.readPreferences(), {
    links: [''],
    groupBy: null,
    filterBy: 'grouping',
    minimumParticipants: 3,
  });
  for (const [value, expected] of [
    [undefined, 3],
    [0, 0],
    [8, 8],
    [-1, 3],
    [0.5, 3],
    [NaN, 3],
    [Infinity, 3],
    [Number.MAX_SAFE_INTEGER + 1, 3],
  ])
    assert.equal(resolveParticipantMinimum(value), expected);
});

test('existing links of any positive length survive while unknown stored fields are ignored', () => {
  for (const count of [1, 2, 4, 7]) {
    const links = Array(count).fill('');
    links[0] = 'https://t.me/groupchat/123';
    const old = JSON.stringify({ links, unusedSetting: 17 });
    const values = storage(old);
    const saved = preferences.readPreferences();
    assert.deepEqual(saved, { ...defaultPreferences(), links });
    assert.equal(values.get(PREFERENCES_KEY), old, 'Reading does not migrate storage');
    assert.equal(preferences.writePreferences(saved), true);
    assert.equal('unusedSetting' in JSON.parse(values.get(PREFERENCES_KEY)), false);
  }
});

test('view settings round trip without losing source identities or confusing duplicate labels', () => {
  storage();
  for (const filterBy of ['grouping', 'none', { pollId: 'username:groupchat/124' }]) {
    const saved = {
      links: ['https://t.me/groupchat/123', ''],
      groupBy: 'username:groupchat/124',
      filterBy,
      minimumParticipants: 0,
    };
    assert.equal(preferences.writePreferences(saved), true);
    assert.deepEqual(preferences.readPreferences(), saved);
  }
});

test('corrupt or incompatible values fall back per field and never coerce stored strings', () => {
  for (const raw of ['{broken', 'null', '[]', '{"links":[]}', '{"links":[1,2]}']) {
    storage(raw);
    assert.deepEqual(preferences.readPreferences(), defaultPreferences());
  }
  for (const minimumParticipants of ['8', null, false, -1, 0.5]) {
    storage(JSON.stringify({ minimumParticipants, groupBy: 1, filterBy: { pollId: 12 } }));
    assert.deepEqual(preferences.readPreferences(), defaultPreferences());
  }
  storage('{"groupBy":"","filterBy":{"pollId":""}}');
  assert.deepEqual(preferences.readPreferences(), defaultPreferences());
});

test('unavailable or denied browser storage remains recoverable', () => {
  assert.deepEqual(preferences.readPreferences(), defaultPreferences());
  assert.equal(preferences.writePreferences(defaultPreferences()), false);
  globalThis.localStorage = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.deepEqual(preferences.readPreferences(), defaultPreferences());
  assert.equal(preferences.writePreferences(defaultPreferences()), false);
});
