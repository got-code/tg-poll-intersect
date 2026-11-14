import { errorDetails } from '../../domain/errors.ts';
import { isRecord } from '../../domain/validation.ts';

const AUTH_METHODS = new Set([
  'auth.sendCode',
  'auth.resendCode',
  'auth.signIn',
  'auth.checkPassword',
  'auth.exportLoginToken',
  'auth.importLoginToken',
  'auth.logOut',
  'account.getPassword',
  'users.getUsers',
]);
const RPC_ERRORS = new Set([
  'API_ID_INVALID',
  'API_ID_PUBLISHED_FLOOD',
  'AUTH_RESTART',
  'PHONE_NUMBER_INVALID',
  'PHONE_NUMBER_BANNED',
  'PHONE_NUMBER_FLOOD',
  'PHONE_NUMBER_UNOCCUPIED',
  'PHONE_NUMBER_APP_SIGNUP_FORBIDDEN',
  'PHONE_CODE_INVALID',
  'PHONE_CODE_EMPTY',
  'PHONE_CODE_EXPIRED',
  'PHONE_CODE_HASH_EMPTY',
  'PHONE_CODE_HASH_INVALID',
  'PHONE_PASSWORD_FLOOD',
  'PHONE_PASSWORD_PROTECTED',
  'PASSWORD_HASH_INVALID',
  'PASSWORD_EMPTY',
  'SESSION_PASSWORD_NEEDED',
  'SESSION_REVOKED',
  'AUTH_KEY_UNREGISTERED',
  'SMS_CODE_CREATE_FAILED',
  'SEND_CODE_UNAVAILABLE',
  'UPDATE_APP_TO_LOGIN',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_INVALID1',
  'AUTH_TOKEN_ALREADY_ACCEPTED',
  'EMAIL_UNCONFIRMED',
  'EMAIL_NOT_ALLOWED',
  'EMAIL_INVALID',
]);

function errorSummary(error: unknown) {
  const details = errorDetails(error);
  const text = details.text;
  const rpcError =
    RPC_ERRORS.has(text) ||
    (typeof text === 'string' &&
      /^(?:FLOOD_WAIT|FLOOD_PREMIUM_WAIT|PHONE_MIGRATE|NETWORK_MIGRATE|USER_MIGRATE|AUTH_RESTART)_\d{1,8}$/.test(
        text,
      ))
      ? text
      : undefined;
  return {
    error:
      rpcError ??
      (/timed?\s*out|timeout/i.test(details.message) ? 'TIMEOUT' : 'UNRECOGNIZED_ERROR'),
    ...(Number.isInteger(details.code) ? { code: details.code } : {}),
  };
}

function responseSummary(response: unknown) {
  // Positive selection: never pass request/response objects to the console.
  const record = isRecord(response) ? response : {};
  const summary: Record<string, string | number | undefined> = {
    result: typeof record._ === 'string' ? record._ : typeof response,
  };
  if (record._ === 'auth.sentCode') {
    const type = isRecord(record.type) ? record.type : {};
    const nextType = isRecord(record.nextType) ? record.nextType : {};
    summary.delivery = typeof type._ === 'string' ? type._ : undefined;
    summary.nextDelivery = typeof nextType._ === 'string' ? nextType._ : 'none';
    summary.timeoutSeconds = typeof record.timeout === 'number' ? record.timeout : 0;
    if (typeof type.length === 'number' && Number.isInteger(type.length))
      summary.codeLength = type.length;
  }
  return summary;
}

export function createTelegramDiagnostics(
  write: (...args: string[]) => void = (...args) => console.info(...args),
) {
  let sequence = 0;
  function log(...args: string[]) {
    try {
      write(...args);
    } catch {
      /* Diagnostics must not interrupt sign-in. */
    }
  }
  return async function traceCall<Response>(
    method: { _: string },
    invoke: () => Promise<Response>,
  ): Promise<Response> {
    if (!AUTH_METHODS.has(method?._)) return invoke();
    const id = ++sequence;
    const prefix = `[Telegram #${id}]`;
    const start = Date.now();
    log(`${prefix} → ${method._}`);
    try {
      const response = await invoke();
      log(
        `${prefix} ← ${method._}`,
        JSON.stringify({ ...responseSummary(response), elapsedMs: Date.now() - start }),
      );
      return response;
    } catch (error) {
      log(
        `${prefix} ✕ ${method._}`,
        JSON.stringify({ ...errorSummary(error), elapsedMs: Date.now() - start }),
      );
      throw error;
    }
  };
}
