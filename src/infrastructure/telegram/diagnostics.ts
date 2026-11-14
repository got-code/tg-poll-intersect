import { readTelegramFailure } from './errors.ts';
import { isRecord } from '../validation.ts';

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
const POLL_METHODS = new Set([
  'messages.getPollVotes',
  'messages.getMessages',
  'channels.getMessages',
  'contacts.resolveUsername',
  'channels.getChannels',
  'messages.getDialogs',
]);

function errorSummary(error: unknown) {
  const details = readTelegramFailure(error);
  return {
    error:
      details.rpcCode ??
      (details.kind === 'unexpected'
        ? 'UNRECOGNIZED_ERROR'
        : details.kind.toUpperCase().replaceAll('-', '_')),
    ...(details.status === undefined ? {} : { code: details.status }),
    ...(details.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: details.retryAfterSeconds }),
    ...(details.timeoutMs === undefined ? {} : { timeoutMs: details.timeoutMs }),
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
    const auth = AUTH_METHODS.has(method?._);
    if (!auth && !POLL_METHODS.has(method?._)) return invoke();
    const id = ++sequence;
    const prefix = `[Telegram #${id}]`;
    const start = Date.now();
    if (auth) log(`${prefix} → ${method._}`);
    try {
      const response = await invoke();
      if (auth)
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
