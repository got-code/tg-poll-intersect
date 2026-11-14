import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lazyTelegram } from '../src/infrastructure/telegram/loader.ts';
import { UserFacingError } from '../src/application/errors.ts';

test('preloading and immediate use share a pending load, and successful code stays available', async () => {
  const pending = Promise.withResolvers();
  let requests = 0;
  const load = lazyTelegram(() => {
    requests++;
    return pending.promise;
  });
  assert.equal(requests, 0);
  const warming = load();
  const signingIn = load();
  const code = {};
  pending.resolve(code);
  assert.equal(await warming, code);
  assert.equal(await signingIn, code);
  assert.equal(await load(), code);
  assert.equal(requests, 1);
});

test('failed preloading produces a safe error and allows a fresh loading attempt', async () => {
  let requests = 0;
  const code = {};
  const load = lazyTelegram(async () => {
    if (++requests === 1) throw new Error('SECRET transport details');
    return code;
  });
  await assert.rejects(
    load(),
    (error) =>
      error instanceof UserFacingError &&
      /load Telegram support/.test(error.message) &&
      !error.message.includes('SECRET'),
  );
  assert.equal(await load(), code);
  assert.equal(requests, 2);
});
