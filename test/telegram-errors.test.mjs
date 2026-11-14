import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTelegramErrors } from '../src/infrastructure/telegram/errors.ts';
import {
  PasswordRequiredError,
  REQUEST_FAILED_MESSAGE,
  ServiceError,
  UserFacingError,
} from '../src/application/errors.ts';
import { DomainError } from '../src/domain/errors.ts';
import { explainError } from '../src/presentation/errors.ts';
import {
  tl,
  MtTimeoutError,
  MtPeerNotFoundError,
  MtMessageNotFoundError,
  MtInvalidPeerTypeError,
  MtSecurityError,
  MtTypeAssertionError,
} from '@mtcute/web';

test('the Telegram boundary translates 2FA into an application signal and known failures into safe messages', async () => {
  for (const raw of [{ text: 'SESSION_PASSWORD_NEEDED' }, new Error('SESSION_PASSWORD_NEEDED')])
    await assert.rejects(
      withTelegramErrors(async () => {
        throw raw;
      }),
      PasswordRequiredError,
    );
  for (const [raw, expected] of [
    [{ text: 'PHONE_CODE_INVALID', message: 'SECRET' }, /Incorrect code/],
    [{ text: 'PASSWORD_HASH_INVALID' }, /Incorrect two-step/],
    [{ name: 'MSG_ID_INVALID', message: 'SECRET' }, /rejected the message ID/],
    [{ text: 'FLOOD_WAIT_120' }, /limiting requests/],
    [new Error('Request timed out: SECRET'), /request timed out/],
  ]) {
    await assert.rejects(
      withTelegramErrors(async () => {
        throw raw;
      }),
      (error) => {
        assert.ok(error instanceof UserFacingError);
        assert.match(explainError(error), expected);
        assert.ok(!error.message.includes('SECRET'));
        return true;
      },
    );
  }
});

test('unknown SDK failures omit raw payloads and explicitly report that the cause is unknown', async () => {
  const raw = Object.assign(new Error('SECRET_API_HASH'), {
    text: 'SECRET_PHONE',
    payload: 'SECRET_SESSION',
  });
  await assert.rejects(
    withTelegramErrors(async () => {
      throw raw;
    }),
    (error) => {
      assert.ok(error instanceof UserFacingError);
      assert.notEqual(error, raw);
      assert.equal(error.message, REQUEST_FAILED_MESSAGE);
      assert.equal(error.cause, undefined);
      assert.ok(!JSON.stringify(error).includes('SECRET'));
      return true;
    },
  );
  assert.equal(explainError(raw), REQUEST_FAILED_MESSAGE);
  assert.equal(
    explainError(new DomainError('Four polls are required.')),
    'Four polls are required.',
  );
  const expected = new UserFacingError('An incomplete poll was rejected.');
  await assert.rejects(
    withTelegramErrors(async () => {
      throw expected;
    }),
    (error) => error === expected,
  );
  assert.equal(await withTelegramErrors(async () => 'done'), 'done');
});

test('RPC codes, statuses and SDK-normalized wait times survive translation and reach presentation', async () => {
  for (const [code, status, expected] of [
    ['CHANNEL_PRIVATE', 403, /does not have access/],
    ['USERNAME_NOT_OCCUPIED', 400, /No Telegram chat was found/],
    ['POLL_ACCESS_UNSUPPORTED', 403, /refused this operation/],
    ['SERVER_BUSY', 500, /server error/],
    ['FLOOD_WAIT_120', 420, /Wait 120 seconds/],
    ['PHONE_MIGRATE_4', 303, /different data center/],
    ['EMAIL_UNCONFIRMED_6', 400, /Complete email verification/],
  ]) {
    const raw = tl.RpcError.fromTl({ errorCode: status, errorMessage: code });
    raw.message = 'SECRET session, phone and API hash';
    raw.payload = { session: 'SECRET' };
    await assert.rejects(
      withTelegramErrors(async () => {
        throw raw;
      }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.details.kind, 'rpc');
        assert.equal(error.details.service, 'Telegram');
        assert.equal(error.details.status, status);
        assert.equal(error.details.rpcCode, code);
        if (code === 'FLOOD_WAIT_120') assert.equal(error.details.retryAfterSeconds, 120);
        const text = explainError(error);
        assert.match(text, expected);
        assert.ok(text.includes(code));
        assert.ok(text.includes(`RPC ${status}`));
        assert.ok(!text.includes('SECRET'));
        assert.ok(!JSON.stringify(error).includes('SECRET'));
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

test('SDK timeout and resolution failures keep their specific reason without exposing identifiers', async () => {
  for (const [raw, kind, expected] of [
    [new MtTimeoutError(5000), 'timeout', /within 5 seconds/],
    [new MtPeerNotFoundError('SECRET_CHAT_ID'), 'peer-not-found', /group could not be resolved/],
    [
      new MtMessageNotFoundError(987654321, 87654321),
      'message-not-found',
      /could not find the poll message/,
    ],
    [new MtInvalidPeerTypeError('SECRET_CHAT_ID', 'channel'), 'invalid-peer', /chat reference/],
    [new MtSecurityError('SECRET_AUTH_KEY timeout'), 'security-check', /security check/],
    [
      new MtTypeAssertionError('expected', 'SECRET_RESPONSE'),
      'unexpected-response',
      /unexpected response/,
    ],
    [new TypeError('Failed to fetch'), 'network', /browser reported a network error/],
  ]) {
    await assert.rejects(
      withTelegramErrors(async () => {
        throw raw;
      }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.details.kind, kind);
        assert.match(explainError(error), expected);
        if (kind === 'timeout') assert.equal(error.details.timeoutMs, 5000);
        assert.ok(!explainError(error).includes('SECRET'));
        assert.ok(!JSON.stringify(error).includes('SECRET'));
        assert.ok(!explainError(error).includes('987654321'));
        assert.ok(!explainError(error).includes('87654321'));
        return true;
      },
    );
  }
});
