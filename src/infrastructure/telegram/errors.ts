import {
  MtInvalidPeerTypeError,
  MtMessageNotFoundError,
  MtPeerNotFoundError,
  MtSecurityError,
  MtTimeoutError,
  MtTypeAssertionError,
  tl,
} from '@mtcute/web';
import {
  PasswordRequiredError,
  REQUEST_FAILED_MESSAGE,
  ServiceError,
  UserFacingError,
} from '../../application/errors.ts';
import { isRecord } from '../validation.ts';
import type { ServiceFailure } from '../../application/errors.ts';

const RPC_MESSAGES: Record<string, string> = {
  POLL_VOTE_REQUIRED: 'Vote in each poll in Telegram first, then refresh the results.',
  BROADCAST_FORBIDDEN: 'Telegram does not expose voter lists in channels. Use polls in a group.',
  API_ID_INVALID: 'Check your API ID and API hash from my.telegram.org/apps.',
  API_ID_PUBLISHED_FLOOD: 'Telegram rejected these API keys. Use your own application’s keys.',
  PHONE_NUMBER_INVALID: 'Check the phone number, including the country code.',
  PHONE_NUMBER_BANNED: 'Telegram has banned this phone number.',
  PHONE_NUMBER_FLOOD:
    'Telegram is limiting sign-in attempts for this phone number. Try again later.',
  PHONE_NUMBER_UNOCCUPIED:
    'This phone number has no Telegram account. Register in the Telegram app first.',
  PHONE_NUMBER_APP_SIGNUP_FORBIDDEN: 'Complete account registration in the Telegram app first.',
  PHONE_CODE_INVALID: 'Incorrect code. Check the code from Telegram.',
  PHONE_CODE_EMPTY: 'Enter the code received from Telegram.',
  PHONE_CODE_EXPIRED: 'The code expired. Close the dialog and start signing in again.',
  PHONE_CODE_HASH_EMPTY: 'Start signing in again to request a new code.',
  PHONE_CODE_HASH_INVALID: 'Start signing in again to request a new code.',
  PHONE_PASSWORD_FLOOD: 'Telegram is limiting password attempts. Try again later.',
  PASSWORD_HASH_INVALID: 'Incorrect two-step verification password.',
  PASSWORD_EMPTY: 'Enter your two-step verification password.',
  AUTH_TOKEN_EXPIRED: 'The QR code expired. Show a new QR code and scan it again.',
  AUTH_TOKEN_INVALID: 'The QR code is no longer valid. Show a new QR code and scan it again.',
  AUTH_TOKEN_INVALID1: 'The QR code is no longer valid. Show a new QR code and scan it again.',
  AUTH_TOKEN_ALREADY_ACCEPTED: 'The QR code has already been used. Start signing in again.',
  AUTH_RESTART: 'Telegram requires a fresh login. Close the dialog and try again.',
  SESSION_REVOKED: 'The session was revoked. Sign out and sign in again.',
  SESSION_EXPIRED: 'The login expired. Sign out and sign in again.',
  AUTH_KEY_UNREGISTERED: 'The login expired. Sign out and sign in again.',
  AUTH_KEY_INVALID: 'Telegram rejected the login key. Sign out and sign in again.',
  AUTH_KEY_DUPLICATED:
    'Telegram invalidated this login because it was used by conflicting connections. Sign out and sign in again.',
  USER_DEACTIVATED: 'This Telegram account has been deactivated.',
  USER_DEACTIVATED_BAN: 'Telegram has banned this account.',
  CHANNEL_PRIVATE: 'This account does not have access to the group.',
  CHANNEL_INVALID: 'Telegram rejected the group reference. Check the poll link.',
  CHAT_ADMIN_REQUIRED: 'Telegram requires administrator permissions for this operation.',
  USER_BANNED_IN_CHANNEL: 'This account is banned from the group.',
  USER_NOT_PARTICIPANT: 'This account is not a member of the group. Join it in Telegram first.',
  PEER_ID_INVALID:
    'Telegram rejected the chat reference. Check the link and that this account has joined the group.',
  USERNAME_INVALID: 'The group username in the link is invalid.',
  USERNAME_NOT_OCCUPIED: 'No Telegram chat was found with the username in the link.',
  MSG_ID_INVALID: 'Telegram rejected the message ID. Check the poll link.',
  MESSAGE_ID_INVALID: 'Telegram rejected the message ID. Check the poll link.',
  POLL_INVALID: 'Telegram rejected the poll reference. Check the message link.',
  SMS_CODE_CREATE_FAILED: 'Telegram could not create an SMS login code. Try again later.',
  SEND_CODE_UNAVAILABLE:
    'Telegram cannot deliver a login code using this method. Try QR sign-in or try again later.',
  UPDATE_APP_TO_LOGIN: 'Telegram requires a newer sign-in protocol. This app needs an update.',
  EMAIL_UNCONFIRMED: 'Complete email verification in the Telegram app first.',
  EMAIL_NOT_ALLOWED: 'Telegram rejected the email address for sign-in.',
  EMAIL_INVALID: 'Telegram rejected the email address for sign-in.',
};
const SAFE_RPC_CODES = new Set([
  ...Object.keys(RPC_MESSAGES),
  'SESSION_PASSWORD_NEEDED',
  'PHONE_PASSWORD_PROTECTED',
]);
const PARAMETERIZED_RPC =
  /^(?:FLOOD_WAIT|FLOOD_PREMIUM_WAIT|SLOWMODE_WAIT|PHONE_MIGRATE|NETWORK_MIGRATE|USER_MIGRATE|AUTH_RESTART|EMAIL_UNCONFIRMED)_(?:\d{1,8}|%d)$/;
const SDK_FAILURES = [
  [MtPeerNotFoundError, 'peer-not-found'],
  [MtMessageNotFoundError, 'message-not-found'],
  [MtInvalidPeerTypeError, 'invalid-peer'],
  [MtSecurityError, 'security-check'],
  [MtTypeAssertionError, 'unexpected-response'],
] as const;
const safeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function readTelegramFailure(error: unknown): ServiceFailure {
  if (error instanceof ServiceError) return error.details;
  const record = isRecord(error) ? error : {};
  const candidates = [record.text, record.message, record.name];
  // Only actual SDK RPC errors may supply an unfamiliar server code. Other
  // exceptions are matched against known codes, never copied into diagnostics.
  const rpcCode = tl.RpcError.is(error)
    ? /^(?:[A-Z0-9_]|%d){1,80}$/.test(error.text)
      ? error.text
      : undefined
    : candidates.find(
        (value): value is string =>
          typeof value === 'string' && (SAFE_RPC_CODES.has(value) || PARAMETERIZED_RPC.test(value)),
      );
  const service = 'Telegram';
  if (tl.RpcError.is(error) || rpcCode) {
    // The SDK replaces numeric RPC arguments with %d. Restore the server code
    // here so application contracts and presentation do not parse SDK formats.
    const parameters = ['seconds', 'newDc', 'dc', 'codeLength', 'duration', 'minutes', 'which']
      .map((key) => record[key])
      .filter(safeNumber);
    const serverCode =
      rpcCode && parameters.length === 1 ? rpcCode.replace('%d', String(parameters[0])) : rpcCode;
    const status =
      safeNumber(record.code) && record.code >= 100 && record.code <= 599 ? record.code : undefined;
    const seconds = serverCode?.match(
      /^(?:FLOOD_WAIT|FLOOD_PREMIUM_WAIT|SLOWMODE_WAIT)_(\d{1,8})$/,
    )?.[1];
    const retryAfterSeconds = safeNumber(record.seconds)
      ? record.seconds
      : seconds === undefined
        ? undefined
        : Number(seconds);
    return {
      service,
      kind: 'rpc',
      ...(serverCode ? { rpcCode: serverCode } : {}),
      ...(status === undefined ? {} : { status }),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  for (const [type, kind] of SDK_FAILURES) if (error instanceof type) return { service, kind };
  if (
    error instanceof MtTimeoutError ||
    (typeof record.message === 'string' && /timed?\s*out|timeout/i.test(record.message))
  )
    return {
      service,
      kind: 'timeout',
      ...(error instanceof MtTimeoutError && safeNumber(error.timeout)
        ? { timeoutMs: error.timeout }
        : {}),
    };
  if (
    record.name === 'NetworkError' ||
    (error instanceof TypeError && record.message === 'Failed to fetch')
  )
    return { service, kind: 'network' };
  return { service, kind: 'unexpected' };
}

function messageFor(failure: ServiceFailure) {
  switch (failure.kind) {
    case 'timeout':
      return failure.timeoutMs === undefined
        ? 'The Telegram request timed out. Try again.'
        : `Telegram did not respond within ${failure.timeoutMs / 1000} seconds. Try again.`;
    case 'network':
      return 'The browser reported a network error while contacting Telegram. Check your connection and retry.';
    case 'peer-not-found':
      return 'The group could not be resolved. Check the link and that this account has joined the group.';
    case 'message-not-found':
      return 'Telegram could not find the poll message. Check the link.';
    case 'invalid-peer':
      return 'Telegram could not use this chat reference. Check the poll link.';
    case 'security-check':
      return 'The Telegram connection failed a security check. Close the dialog and try again.';
    case 'unexpected-response':
      return 'Telegram returned an unexpected response. Try again.';
    case 'rpc': {
      const code = failure.rpcCode ?? '';
      if (Object.hasOwn(RPC_MESSAGES, code)) return RPC_MESSAGES[code];
      if (code.startsWith('AUTH_RESTART_')) return RPC_MESSAGES.AUTH_RESTART;
      if (code.startsWith('EMAIL_UNCONFIRMED_')) return RPC_MESSAGES.EMAIL_UNCONFIRMED;
      if (/^(?:FLOOD|SLOWMODE)/.test(code) || failure.status === 420)
        return failure.retryAfterSeconds === undefined
          ? 'Telegram is limiting requests. Wait before trying again.'
          : `Telegram is limiting requests. Wait ${failure.retryAfterSeconds} seconds before trying again.`;
      if (failure.status === 401) return 'Telegram rejected the login. Sign in again.';
      if (failure.status === 303)
        return 'Telegram requested a different data center. Reconnect and try again.';
      if (failure.status === 403) return 'Telegram refused this operation for this account.';
      if (failure.status !== undefined && failure.status >= 500)
        return 'Telegram reported a server error. Try again later.';
      return 'Telegram rejected the request.';
    }
    default:
      return REQUEST_FAILED_MESSAGE;
  }
}

export async function withTelegramErrors<T>(invoke: () => Promise<T>): Promise<T> {
  try {
    return await invoke();
  } catch (error) {
    if (error instanceof UserFacingError || error instanceof PasswordRequiredError) throw error;
    const failure = readTelegramFailure(error);
    if (failure.rpcCode === 'SESSION_PASSWORD_NEEDED') throw new PasswordRequiredError();
    throw new ServiceError(messageFor(failure), failure);
  }
}
