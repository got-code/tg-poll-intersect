import { UserFacingError, errorDetails } from '../domain/errors.ts';
import type {
  AuthDependencies,
  AuthSession,
  AuthUser,
  CodeDelivery,
  LoginCredentials,
  LoginKind,
  LoginMethod,
  LoginResult,
  SessionClient,
  SignOutResult,
} from './auth-contracts.ts';

function validateCredentials(apiId: string, apiHash: string, phone: string, method: LoginMethod) {
  if (
    !Number.isInteger(Number(apiId)) ||
    Number(apiId) < 1 ||
    Number(apiId) > 2147483647 ||
    !/^[0-9a-fA-F]{32}$/.test(apiHash)
  ) {
    throw new UserFacingError('Check the numeric API ID and 32-character API hash.');
  }
  if (method === 'phone' && !/^\+[\d\s()-]{7,24}$/.test(phone.trim())) {
    throw new UserFacingError('Enter your phone number with a country code, starting with +.');
  }
}

// Owns client lifetimes and login workflows; adapters supply Telegram and saved-session operations.
export function createAuthSession<Client extends SessionClient>({
  createClient,
  auth,
  sessions,
}: AuthDependencies<Client>): AuthSession<Client> {
  interface Attempt {
    client: Client | null;
    phone: string;
    codeHash: string;
    user: AuthUser | null;
    remember: boolean;
    abort: AbortController;
  }
  let client: Client | null = null;
  let attempt: Attempt | null = null;
  const current = (value: Attempt) => attempt === value;

  function cancel() {
    const old = attempt;
    attempt = null;
    if (!old) return;
    old.phone = '';
    old.codeHash = '';
    old.user = null;
    old.abort.abort();
    old.client?.destroy().catch(() => {});
  }

  function newAttempt(remember = false) {
    cancel();
    attempt = {
      client: null,
      phone: '',
      codeHash: '',
      user: null,
      remember,
      abort: new AbortController(),
    };
    return attempt;
  }

  function pending() {
    if (!attempt?.client) throw new UserFacingError('Start signing in again.');
    return { value: attempt, client: attempt.client };
  }

  function complete(value: Attempt, kind: LoginKind = 'signed-in'): LoginResult {
    if (!current(value)) return null;
    if (!value.user || !value.client) throw new UserFacingError('Complete signing in first.');
    const user = value.user;
    client = value.client;
    value.phone = '';
    value.codeHash = '';
    value.user = null;
    attempt = null;
    return { step: 'complete', user, kind };
  }

  function accept(value: Attempt, user: AuthUser): LoginResult {
    if (!current(value)) return null;
    value.user = user;
    return value.remember ? { step: 'save' } : complete(value);
  }

  async function authenticate(
    value: Attempt,
    operation: () => Promise<LoginResult>,
  ): Promise<LoginResult> {
    try {
      return await operation();
    } catch (error) {
      if (!current(value)) return null;
      const details = errorDetails(error);
      if ((details.text || details.message).includes('SESSION_PASSWORD_NEEDED'))
        return { step: 'password' };
      throw error;
    }
  }

  async function begin({
    apiId,
    apiHash,
    phone = '',
    method = 'phone',
    remember = false,
    onUrlUpdated,
    onQrScanned,
  }: LoginCredentials): Promise<LoginResult> {
    validateCredentials(apiId, apiHash, phone, method);
    const value = newAttempt(remember);
    const pendingClient = createClient(Number(apiId), apiHash, { qrLogin: method === 'qr' });
    value.client = pendingClient;
    return authenticate(value, async () => {
      if (method === 'qr') {
        const user = await auth.qr(pendingClient, {
          abortSignal: value.abort.signal,
          onUrlUpdated: (...args) => {
            if (current(value)) onUrlUpdated?.(...args);
          },
          onQrScanned: () => {
            if (current(value)) onQrScanned?.();
          },
        });
        return accept(value, user);
      }
      value.phone = phone.trim();
      const sent = await auth.sendCode(pendingClient, value.phone);
      if (!current(value)) return null;
      if (!('phoneCodeHash' in sent)) return accept(value, sent);
      const deliveries: readonly string[] = [
        'app',
        'sms',
        'call',
        'email',
        'sms_word',
        'sms_phrase',
      ];
      if (!deliveries.includes(sent.type)) {
        throw new UserFacingError('Telegram requested an unsupported sign-in method.');
      }
      value.codeHash = sent.phoneCodeHash;
      return { step: 'code', delivery: sent.type as CodeDelivery };
    });
  }

  function submitCode(code: string) {
    const { value, client: pendingClient } = pending();
    return authenticate(value, async () =>
      accept(value, await auth.signIn(pendingClient, value.phone, value.codeHash, code.trim())),
    );
  }

  function submitPassword(password: string) {
    const { value, client: pendingClient } = pending();
    return authenticate(value, async () =>
      accept(value, await auth.password(pendingClient, password)),
    );
  }

  async function save(password: string) {
    const { value, client: pendingClient } = pending();
    sessions.validateSavePassword(password);
    const session = await pendingClient.exportSession();
    if (!current(value)) return null;
    const credentials = await pendingClient.getApiCredentials();
    if (!current(value)) return null;
    const encrypted = await sessions.encryptSession(
      { apiId: credentials.id, apiHash: credentials.hash, session },
      password,
    );
    if (!current(value)) return null;
    sessions.writeSavedSession(encrypted);
    return complete(value, 'saved');
  }

  async function unlock(password: string) {
    const value = newAttempt();
    const data = await sessions.decryptSession(sessions.readSavedSession(), password);
    if (!current(value)) return null;
    const pendingClient = createClient(data.apiId, data.apiHash);
    value.client = pendingClient;
    try {
      await pendingClient.importSession(data.session);
      if (!current(value)) return null;
      const user = await auth.me(pendingClient);
      if (!current(value)) return null;
      value.user = user;
      return complete(value, 'unlocked');
    } catch (error) {
      if (!current(value)) return null;
      cancel();
      throw error;
    }
  }

  async function signOut(): Promise<SignOutResult> {
    cancel();
    let storageError: unknown = null;
    try {
      sessions.forgetSavedSession();
    } catch (error) {
      storageError = error;
    }
    const old = client;
    client = null;
    let revoked = false;
    if (old) {
      try {
        await auth.logout(old);
        revoked = true;
      } catch {
        /* Discard the local session even when offline. */
      }
      await old.destroy().catch(() => {});
    }
    return { revoked, storageError };
  }

  return {
    getClient: () => client,
    isConnected: () => !!client,
    hasSavedLogin: () => sessions.hasSavedSession(),
    validateSavePassword: (password) => sessions.validateSavePassword(password),
    begin,
    submitCode,
    submitPassword,
    save,
    unlock,
    cancel,
    signOut,
    skipSaving: () => (attempt?.user ? complete(attempt, 'memory') : null),
    forgetSavedLogin() {
      sessions.forgetSavedSession();
      cancel();
    },
  };
}
