import { PasswordRequiredError, UserFacingError } from '../../../application/errors.ts';
import { validateSavePassword } from './save-password.ts';
import type {
  AuthDependencies,
  AuthSession,
  AuthUser,
  LoginCredentials,
  LoginKind,
  LoginMethod,
  LoginResult,
  SessionClient,
  SignOutResult,
} from './contracts.ts';

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
}: AuthDependencies<Client>): AuthSession & { getClient(): Client | null } {
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

  async function startClient(
    value: Attempt,
    ...args: Parameters<AuthDependencies<Client>['createClient']>
  ) {
    const pendingClient = await createClient(...args);
    if (!current(value)) {
      await pendingClient.destroy().catch(() => {});
      return null;
    }
    value.client = pendingClient;
    return pendingClient;
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
      if (error instanceof PasswordRequiredError) return { step: 'password' };
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
    return authenticate(value, async () => {
      const pendingClient = await startClient(value, Number(apiId), apiHash, {
        qrLogin: method === 'qr',
      });
      if (!pendingClient) return null;
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
      if (!('codeToken' in sent)) return accept(value, sent);
      value.codeHash = sent.codeToken;
      return { step: 'code', delivery: sent.delivery };
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
    validateSavePassword(password);
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
    try {
      const data = await sessions.decryptSession(sessions.readSavedSession(), password);
      if (!current(value)) return null;
      const pendingClient = await startClient(value, data.apiId, data.apiHash);
      if (!pendingClient) return null;
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
    validateSavePassword,
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
