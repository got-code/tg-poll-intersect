const AUTH_METHODS = new Set([
  'auth.sendCode', 'auth.resendCode', 'auth.signIn', 'auth.checkPassword',
  'auth.logOut', 'account.getPassword', 'users.getUsers',
]);
const RPC_ERRORS = new Set([
  'API_ID_INVALID', 'API_ID_PUBLISHED_FLOOD', 'AUTH_RESTART',
  'PHONE_NUMBER_INVALID', 'PHONE_NUMBER_BANNED', 'PHONE_NUMBER_FLOOD',
  'PHONE_NUMBER_UNOCCUPIED', 'PHONE_NUMBER_APP_SIGNUP_FORBIDDEN',
  'PHONE_CODE_INVALID', 'PHONE_CODE_EMPTY', 'PHONE_CODE_EXPIRED',
  'PHONE_CODE_HASH_EMPTY', 'PHONE_CODE_HASH_INVALID', 'PHONE_PASSWORD_FLOOD',
  'PHONE_PASSWORD_PROTECTED', 'PASSWORD_HASH_INVALID', 'PASSWORD_EMPTY',
  'SESSION_PASSWORD_NEEDED', 'SESSION_REVOKED', 'AUTH_KEY_UNREGISTERED',
  'SMS_CODE_CREATE_FAILED', 'SEND_CODE_UNAVAILABLE', 'UPDATE_APP_TO_LOGIN',
  'EMAIL_UNCONFIRMED', 'EMAIL_NOT_ALLOWED', 'EMAIL_INVALID',
]);

function errorSummary(error) {
  const text = error?.text;
  const rpcError = RPC_ERRORS.has(text) || typeof text === 'string' && /^(?:FLOOD_WAIT|FLOOD_PREMIUM_WAIT|PHONE_MIGRATE|NETWORK_MIGRATE|USER_MIGRATE|AUTH_RESTART)_\d{1,8}$/.test(text)
    ? text : undefined;
  return {
    error: rpcError ?? (/timed?\s*out|timeout/i.test(error?.message ?? '') ? 'TIMEOUT' : 'UNRECOGNIZED_ERROR'),
    ...(Number.isInteger(error?.code) ? { code: error.code } : {}),
  };
}

function responseSummary(response) {
  // Positive selection: never pass request/response objects to the console.
  const summary = { result: response?._ ?? typeof response };
  if (response?._ === 'auth.sentCode') {
    summary.delivery = response.type?._;
    summary.nextDelivery = response.nextType?._ ?? 'none';
    summary.timeoutSeconds = response.timeout ?? 0;
    if (Number.isInteger(response.type?.length)) summary.codeLength = response.type.length;
  }
  return summary;
}

export function createTelegramDiagnostics(write = (...args) => console.info(...args)) {
  let sequence = 0;
  function log(...args) {
    try { write(...args); } catch { /* Diagnostics must not interrupt sign-in. */ }
  }
  return async function traceCall(method, invoke) {
    if (!AUTH_METHODS.has(method?._)) return invoke();
    const id = ++sequence;
    const prefix = `[Telegram #${id}]`;
    const start = Date.now();
    log(`${prefix} → ${method._}`);
    try {
      const response = await invoke();
      log(`${prefix} ← ${method._}`, JSON.stringify({ ...responseSummary(response), elapsedMs: Date.now() - start }));
      return response;
    } catch (error) {
      log(`${prefix} ✕ ${method._}`, JSON.stringify({ ...errorSummary(error), elapsedMs: Date.now() - start }));
      throw error;
    }
  };
}
