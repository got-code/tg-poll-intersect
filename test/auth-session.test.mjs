import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSession } from '../src/modules/auth/application/session.ts';

const credentials = {
  apiId: 12345,
  apiHash: 'abcdef0123456789abcdef0123456789',
  phone: '+381123456789',
};
const user = { displayName: 'Test' };

function setup({ beforeCreate } = {}) {
  const clients = [],
    writes = [],
    signIns = [];
  const auth = {
    sendCode: async () => ({ codeToken: 'current-hash', delivery: 'app' }),
    signIn: async (...args) => {
      signIns.push(args);
      return user;
    },
    me: async () => user,
    logout: async () => {},
  };
  const sessions = {
    hasSavedSession: () => true,
    readSavedSession: () => 'encrypted login',
    decryptSession: async () => ({ ...credentials, session: 'stored session' }),
    encryptSession: async () => 'new encrypted login',
    writeSavedSession: (value) => writes.push(value),
    forgetSavedSession() {},
  };
  const session = createAuthSession({
    auth,
    sessions,
    async createClient() {
      await beforeCreate?.();
      const client = {
        destroyed: false,
        async destroy() {
          this.destroyed = true;
        },
        async exportSession() {
          return 'exported session';
        },
        async getApiCredentials() {
          return { id: credentials.apiId, hash: credentials.apiHash };
        },
        async importSession() {},
      };
      clients.push(client);
      return client;
    },
  });
  return { session, auth, sessions, clients, writes, signIns };
}

test('a late phone-code response cannot replace the new login attempt', async () => {
  const view = setup();
  const late = Promise.withResolvers();
  const started = Promise.withResolvers();
  view.auth.sendCode = () => {
    started.resolve();
    return late.promise;
  };
  const cancelled = view.session.begin(credentials);
  await started.promise;
  view.session.cancel();
  view.auth.sendCode = async () => ({ codeToken: 'new-hash', delivery: 'app' });
  await view.session.begin(credentials);
  late.resolve({ codeToken: 'late-hash', delivery: 'sms' });
  assert.equal(await cancelled, null);
  const result = await view.session.submitCode(' 12345 ');
  assert.equal(result.user, user);
  assert.deepEqual(view.signIns[0], [view.clients[1], credentials.phone, 'new-hash', '12345']);
  assert.equal(view.clients[0].destroyed, true);
  assert.equal(view.session.getClient(), view.clients[1]);
});

test('cancelling or replacing an attempt during client creation destroys late clients without authenticating', async () => {
  for (const mode of ['cancel', 'replace', 'unlock']) {
    const loading = Promise.withResolvers();
    const started = Promise.withResolvers();
    let creates = 0;
    const view = setup({
      beforeCreate: () => {
        if (++creates === 1) {
          started.resolve();
          return loading.promise;
        }
      },
    });
    const requests = [];
    view.auth.sendCode = async (client) => {
      requests.push(client);
      return { codeToken: 'current-hash', delivery: 'app' };
    };
    view.auth.me = async (client) => {
      requests.push(client);
      return user;
    };
    const stale =
      mode === 'unlock' ? view.session.unlock('Test1234') : view.session.begin(credentials);
    await started.promise;
    view.session.cancel();
    if (mode === 'replace') await view.session.begin(credentials);
    loading.resolve();
    assert.equal(await stale, null);
    assert.equal(view.clients.at(-1).destroyed, true);
    assert.equal(view.session.isConnected(), false);
    assert.equal(requests.length, mode === 'replace' ? 1 : 0);
    if (mode === 'replace') {
      await view.session.submitCode('12345');
      assert.equal(view.session.getClient(), requests[0]);
      assert.equal(requests[0].destroyed, false);
    }
  }
});

test('client loading failures leave sign-in retryable and a cancelled failure cannot affect a newer attempt', async () => {
  const failed = Promise.withResolvers();
  const started = Promise.withResolvers();
  let creates = 0;
  const view = setup({
    beforeCreate: () => {
      if (++creates === 1) {
        started.resolve();
        return failed.promise;
      }
    },
  });
  const stale = view.session.begin(credentials);
  await started.promise;
  await view.session.begin(credentials);
  failed.reject(new Error('Late load failure'));
  assert.equal(await stale, null);
  await view.session.submitCode('12345');
  assert.equal(view.session.getClient(), view.clients[0]);

  let reject = true;
  const retry = setup({
    beforeCreate: () => {
      if (reject) throw new Error('Load failure');
    },
  });
  await assert.rejects(retry.session.begin(credentials), /Load failure/);
  assert.equal(retry.session.isConnected(), false);
  reject = false;
  await retry.session.begin(credentials);
  await retry.session.submitCode('12345');
  assert.equal(retry.session.isConnected(), true);
});

test('cancelling during encryption prevents persistence and activation of the login', async () => {
  const view = setup();
  const encrypted = Promise.withResolvers(),
    started = Promise.withResolvers();
  view.sessions.encryptSession = () => {
    started.resolve();
    return encrypted.promise;
  };
  await view.session.begin({ ...credentials, remember: true });
  assert.equal((await view.session.submitCode('12345')).step, 'save');
  const saving = view.session.save('Test1234');
  await started.promise;
  view.session.cancel();
  encrypted.resolve('late ciphertext');
  assert.equal(await saving, null);
  assert.deepEqual(view.writes, []);
  assert.equal(view.session.isConnected(), false);
  assert.equal(view.clients[0].destroyed, true);
});

test('cancelling an unlock before decryption finishes never creates a client', async () => {
  const view = setup();
  const decrypted = Promise.withResolvers();
  view.sessions.decryptSession = () => decrypted.promise;
  const unlocking = view.session.unlock('Test1234');
  view.session.cancel();
  decrypted.resolve({ ...credentials, session: 'stored session' });
  assert.equal(await unlocking, null);
  assert.deepEqual(view.clients, []);
  assert.equal(view.session.isConnected(), false);
});

test('a failed restored session is destroyed and the saved login remains available for retry', async () => {
  const view = setup();
  view.auth.me = async () => {
    throw new Error('SESSION_REVOKED');
  };
  await assert.rejects(view.session.unlock('Test1234'), /SESSION_REVOKED/);
  assert.equal(view.clients[0].destroyed, true);
  assert.equal(view.session.isConnected(), false);
  assert.equal(view.session.hasSavedLogin(), true);
  view.auth.me = async () => user;
  assert.equal((await view.session.unlock('Test1234')).kind, 'unlocked');
  assert.equal(view.session.getClient(), view.clients[1]);
});

test('sign-out destroys the local client even when storage removal and server logout fail', async () => {
  const view = setup();
  await view.session.begin(credentials);
  await view.session.submitCode('12345');
  const storageError = new Error('Storage denied');
  view.sessions.forgetSavedSession = () => {
    throw storageError;
  };
  view.auth.logout = async () => {
    throw new Error('Offline');
  };
  assert.deepEqual(await view.session.signOut(), { revoked: false, storageError });
  assert.equal(view.session.getClient(), null);
  assert.equal(view.clients[0].destroyed, true);
});
