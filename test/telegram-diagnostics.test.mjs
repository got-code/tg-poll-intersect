import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramDiagnostics } from '../src/infrastructure/telegram/diagnostics.ts';
import { tl } from '@mtcute/web';

test('auth diagnostics expose delivery information and omit credentials and response bodies', async () => {
  const entries = [];
  const trace = createTelegramDiagnostics((...args) => entries.push(args));
  const request = {
    _: 'auth.sendCode',
    phoneNumber: 'SECRET_PHONE',
    apiId: 987654,
    apiHash: 'SECRET_API_HASH',
    phoneCode: 'SECRET_CODE',
  };
  const response = {
    _: 'auth.sentCode',
    phoneCodeHash: 'SECRET_CODE_HASH',
    type: { _: 'auth.sentCodeTypeApp', length: 5 },
    nextType: { _: 'auth.codeTypeSms' },
    timeout: 60,
    authorization: { authKey: 'SECRET_AUTH_KEY', user: { id: 'SECRET_USER_ID' } },
  };
  assert.equal(await trace(request, async () => response), response);
  assert.equal(entries[0][0], '[Telegram #1] → auth.sendCode');
  const summary = JSON.parse(entries[1][1]);
  assert.equal(summary.result, 'auth.sentCode');
  assert.equal(summary.delivery, 'auth.sentCodeTypeApp');
  assert.equal(summary.nextDelivery, 'auth.codeTypeSms');
  assert.equal(summary.timeoutSeconds, 60);
  assert.equal(summary.codeLength, 5);
  const logs = JSON.stringify(entries);
  assert.ok(!logs.includes('SECRET'));
  assert.ok(!logs.includes('987654'));
});

test('success, no fallback, error and timeout logs preserve RPC results and rejections', async () => {
  const entries = [];
  const trace = createTelegramDiagnostics((...args) => entries.push(args));
  await trace({ _: 'auth.sendCode' }, async () => ({
    _: 'auth.sentCode',
    type: { _: 'auth.sentCodeTypeApp' },
  }));
  assert.equal(JSON.parse(entries.at(-1)[1]).nextDelivery, 'none');
  assert.equal(JSON.parse(entries.at(-1)[1]).timeoutSeconds, 0);
  await trace({ _: 'auth.signIn', phoneCode: 'SECRET_CODE' }, async () => ({
    _: 'auth.authorization',
    user: { firstName: 'SECRET_NAME' },
  }));
  assert.equal(JSON.parse(entries.at(-1)[1]).result, 'auth.authorization');
  for (const text of ['SESSION_PASSWORD_NEEDED', 'FLOOD_WAIT_120', 'PHONE_MIGRATE_4']) {
    const error = Object.assign(new Error('SECRET_ERROR_PAYLOAD'), { code: 400, text });
    await assert.rejects(
      trace({ _: 'auth.sendCode' }, async () => {
        throw error;
      }),
      (value) => value === error,
    );
    assert.equal(JSON.parse(entries.at(-1)[1]).error, text);
  }
  await assert.rejects(
    trace({ _: 'auth.sendCode' }, async () => {
      throw new Error('Request timed out');
    }),
  );
  assert.equal(JSON.parse(entries.at(-1)[1]).error, 'TIMEOUT');
  await assert.rejects(
    trace({ _: 'auth.checkPassword', password: 'SECRET_PASSWORD' }, async () => {
      throw Object.assign(new Error('SECRET_SESSION'), { text: 'SECRET_API_HASH' });
    }),
  );
  assert.equal(JSON.parse(entries.at(-1)[1]).error, 'UNRECOGNIZED_ERROR');
  assert.ok(!JSON.stringify(entries).includes('SECRET'));
});

test('poll data is not logged and console failures cannot prevent authentication', async () => {
  const entries = [];
  const trace = createTelegramDiagnostics((...args) => entries.push(args));
  const votes = { users: ['PRIVATE_NAME'], votes: ['PRIVATE_VOTE'] };
  assert.equal(await trace({ _: 'messages.getPollVotes' }, async () => votes), votes);
  assert.equal(entries.length, 0);
  const brokenConsole = createTelegramDiagnostics(() => {
    throw new Error('console disabled');
  });
  const response = { _: 'auth.sentCode' };
  assert.equal(await brokenConsole({ _: 'auth.sendCode' }, async () => response), response);
});

test('QR diagnostics log token constructors and known errors, never the tokens or API keys', async () => {
  const entries = [];
  const trace = createTelegramDiagnostics((...args) => entries.push(args));
  for (const method of ['auth.exportLoginToken', 'auth.importLoginToken']) {
    const request = { _: method, apiId: 987654, apiHash: 'SECRET_HASH', token: 'SECRET_TOKEN' };
    for (const result of [
      'auth.loginToken',
      'auth.loginTokenMigrateTo',
      'auth.loginTokenSuccess',
    ]) {
      const response = {
        _: result,
        token: 'SECRET_TOKEN',
        authorization: { user: { firstName: 'SECRET_NAME' } },
      };
      assert.equal(await trace(request, async () => response), response);
      assert.equal(JSON.parse(entries.at(-1)[1]).result, result);
    }
    const error = { text: 'AUTH_TOKEN_EXPIRED', code: 400 };
    await assert.rejects(
      trace(request, async () => {
        throw error;
      }),
      (value) => value === error,
    );
    assert.equal(JSON.parse(entries.at(-1)[1]).error, 'AUTH_TOKEN_EXPIRED');
  }
  assert.ok(!JSON.stringify(entries).includes('SECRET'));
  assert.ok(!JSON.stringify(entries).includes('987654'));
});

test('poll-read failures retain method and safe server details without logging poll data', async () => {
  const entries = [];
  const trace = createTelegramDiagnostics((...args) => entries.push(args));
  const raw = tl.RpcError.fromTl({ errorCode: 420, errorMessage: 'FLOOD_WAIT_120' });
  raw.message = 'SECRET_RESPONSE';
  await assert.rejects(
    trace({ _: 'messages.getPollVotes', peer: 'SECRET_CHAT', id: 987654321 }, async () => {
      throw raw;
    }),
    (error) => error === raw,
  );
  assert.equal(entries.length, 1);
  assert.ok(entries[0][0].includes('messages.getPollVotes'));
  const details = JSON.parse(entries[0][1]);
  assert.equal(details.error, 'FLOOD_WAIT_120');
  assert.equal(details.code, 420);
  assert.equal(details.retryAfterSeconds, 120);
  assert.ok(Number.isInteger(details.elapsedMs));
  assert.ok(!JSON.stringify(entries).includes('SECRET'));
  assert.ok(!JSON.stringify(entries).includes('987654321'));
});
