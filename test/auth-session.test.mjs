import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSession } from '../src/application/auth-session.ts';

const credentials = {
  apiId: 12345,
  apiHash: 'abcdef0123456789abcdef0123456789',
  phone: '+381123456789',
};
const user = { displayName: 'Test' };

function setup() {
  const clients = [],
    writes = [],
    signIns = [];
  const auth = {
    sendCode: async () => ({ phoneCodeHash: 'current-hash', type: 'app' }),
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
    validateSavePassword() {},
    writeSavedSession: (value) => writes.push(value),
    forgetSavedSession() {},
  };
  const session = createAuthSession({
    auth,
    sessions,
    createClient() {
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
  view.auth.sendCode = () => late.promise;
  const cancelled = view.session.begin(credentials);
  view.session.cancel();
  view.auth.sendCode = async () => ({ phoneCodeHash: 'new-hash', type: 'app' });
  await view.session.begin(credentials);
  late.resolve({ phoneCodeHash: 'late-hash', type: 'sms' });
  assert.equal(await cancelled, null);
  const result = await view.session.submitCode(' 12345 ');
  assert.equal(result.user, user);
  assert.deepEqual(view.signIns[0], [view.clients[1], credentials.phone, 'new-hash', '12345']);
  assert.equal(view.clients[0].destroyed, true);
  assert.equal(view.session.getClient(), view.clients[1]);
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
