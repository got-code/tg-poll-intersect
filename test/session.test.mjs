import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { encryptSession, decryptSession, writeSavedSession, readSavedSession, hasSavedSession, forgetSavedSession, SESSION_KEY, validateSavePassword } from '../src/infrastructure/session.mjs';

globalThis.crypto ??= webcrypto;
const fixture = { apiId: 12345, apiHash: 'abcdef0123456789abcdef0123456789', session: 'SYNTHETIC_SESSION_SECRET_FOR_TEST_ONLY' };
const password = 'Long test password 1';
const encrypted = await encryptSession(fixture, password);

test('saved session decrypts across reloads; only ciphertext and public crypto parameters persist', async () => {
  const values = new Map([['poll-intersections.preferences.v1', 'links-to-keep']]);
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  writeSavedSession(encrypted);
  assert.equal(hasSavedSession(), true);
  const persisted = readSavedSession();
  for (const secret of [fixture.session, fixture.apiHash, password, String(fixture.apiId)]) assert.ok(!persisted.includes(secret));
  const record = JSON.parse(persisted);
  assert.deepEqual(Object.keys(record).sort(), ['cipher', 'ciphertext', 'iterations', 'iv', 'kdf', 'salt', 'v']);
  // New module instance simulates loss of all in-memory keys at reload.
  const reloaded = await import('../src/infrastructure/session.mjs?reload');
  assert.deepEqual(await reloaded.decryptSession(reloaded.readSavedSession(), password), fixture);
  forgetSavedSession();
  assert.equal(hasSavedSession(), false);
  assert.equal(values.get('poll-intersections.preferences.v1'), 'links-to-keep');
});

test('wrong password and tampered ciphertext cannot unlock or mutate saved data', async () => {
  await assert.rejects(decryptSession(encrypted, 'another long password'), /Wrong password/);
  const damaged = JSON.parse(encrypted);
  const bytes = Buffer.from(damaged.ciphertext, 'base64');
  bytes[0] ^= 1;
  damaged.ciphertext = bytes.toString('base64');
  await assert.rejects(decryptSession(JSON.stringify(damaged), password), /damaged/);
  assert.deepEqual(await decryptSession(encrypted, password), fixture);
});

test('each save has a fresh salt and IV; nonstandard and oversized envelopes are rejected', async () => {
  const second = JSON.parse(await encryptSession(fixture, password));
  const first = JSON.parse(encrypted);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  for (const raw of ['null', 'not json', 'x'.repeat(50001), JSON.stringify({...first, iterations: 999999999}), JSON.stringify({...first, iv: 'aA=='})]) {
    await assert.rejects(decryptSession(raw, password), /format/);
  }
  await assert.rejects(encryptSession(fixture, 'short'), /8/);
});

test('new passwords require 8 characters, lowercase, uppercase and a digit; Cyrillic is supported', () => {
  for (const invalid of ['Abc1234', 'abcdefgh1', 'ABCDEFGH1', 'Abcdefgh', '12345678', '😀😀A1a']) {
    assert.throws(() => validateSavePassword(invalid), /lowercase letter, an uppercase letter and a digit/);
  }
  for (const valid of ['Abcdefg1', 'Пароль12']) assert.doesNotThrow(() => validateSavePassword(valid));
});

test('storage denial is explicit, and plaintext cannot be passed to the persistence API', () => {
  let writes = 0;
  globalThis.localStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { writes++; throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  assert.equal(hasSavedSession(), false);
  assert.throws(() => readSavedSession(), /unavailable/);
  assert.throws(() => writeSavedSession(JSON.stringify(fixture)), /format/);
  assert.equal(writes, 0);
  assert.throws(() => writeSavedSession(encrypted), /without saving/);
  assert.throws(() => forgetSavedSession(), /Could not remove/);
  delete globalThis.localStorage;
});
