import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLink,
  nextMessageLink,
  resolveLinkValues,
  linkIdentity,
} from '../src/modules/polls/application/links.ts';

test('consecutive links preserve public, private and forum paths and URL parameters', () => {
  for (const first of [
    'https://t.me/groupchat/123',
    'https://telegram.me/groupchat/123?single#anchor',
    'https://t.me/c/123456/123',
    'https://t.me/c/123456/10/123?single',
    'https://t.me/groupchat/10/123/',
  ]) {
    const resolved = resolveLinkValues([first, '', '', '']);
    assert.deepEqual(
      resolved.map((value) => parseLink(value).messageId),
      [123, 124, 125, 126],
    );
    assert.equal(new URL(resolved[1]).search, new URL(first).search);
    assert.equal(new URL(resolved[1]).hash, new URL(first).hash);
    assert.equal(
      new URL(resolved[1]).pathname.split('/').slice(0, -1).join('/'),
      new URL(first).pathname.replace(/\/$/, '').split('/').slice(0, -1).join('/'),
    );
  }
});

test('manual overrides restart inference, while missing, invalid or exhausted bases stop it', () => {
  assert.deepEqual(
    resolveLinkValues(['https://t.me/groupchat/10', '', 'https://t.me/otherchat/20', '']),
    [
      'https://t.me/groupchat/10',
      'https://t.me/groupchat/11',
      'https://t.me/otherchat/20',
      'https://t.me/otherchat/21',
    ],
  );
  assert.deepEqual(resolveLinkValues(['', '', '', '']), ['', '', '', '']);
  assert.deepEqual(resolveLinkValues(['bad link', '', 'https://t.me/groupchat/42', '']), [
    'bad link',
    '',
    'https://t.me/groupchat/42',
    'https://t.me/groupchat/43',
  ]);
  assert.deepEqual(resolveLinkValues(['https://t.me/groupchat/2147483647', '', '', '']), [
    'https://t.me/groupchat/2147483647',
    '',
    '',
    '',
  ]);
  assert.throws(() => nextMessageLink('https://t.me/groupchat/2147483647'), /limit/);
  assert.equal(
    linkIdentity(parseLink('https://t.me/GroupChat/123?single')),
    linkIdentity(parseLink('https://telegram.me/groupchat/123')),
  );
});
