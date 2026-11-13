import { UserFacingError } from '../domain/errors.mjs';
import { auth, createClient, explainError } from '../infrastructure/telegram.mjs';
import { hasSavedSession, readSavedSession, writeSavedSession, forgetSavedSession, encryptSession, decryptSession, validateSavePassword } from '../infrastructure/session.mjs';
import { $, status } from './dom.mjs';

export function createAuthController() {
  let client = null, pendingClient = null, authStep = 'credentials';
  let authPhone = '', codeHash = '', generation = 0;
  let continueRefresh = null, authenticatedUser = null;

  function updateConnectionButtons() {
    const saved = hasSavedSession();
    $('connect').hidden = !!client;
    $('connect').textContent = saved ? 'Unlock' : 'Sign in to Telegram';
    $('disconnect').hidden = !client;
  }
  updateConnectionButtons();

  function setAuthStep(step) {
    authStep = step;
    $('credentials').hidden = step !== 'credentials';
    ['apiId', 'apiHash', 'phone'].forEach(id => { $(id).required = step === 'credentials'; $(id).disabled = step !== 'credentials'; });
    $('remember').disabled = step !== 'credentials';
    $('codeLabel').hidden = step !== 'code';
    $('code').required = step === 'code';
    $('code').disabled = step !== 'code';
    $('passwordLabel').hidden = step !== 'password';
    $('password').required = step === 'password';
    $('password').disabled = step !== 'password';
    $('unlockLabel').hidden = step !== 'unlock';
    $('unlockPassword').required = step === 'unlock';
    $('unlockPassword').disabled = step !== 'unlock';
    $('saveFields').hidden = step !== 'save';
    ['savePassword', 'saveConfirm'].forEach(id => { $(id).required = step === 'save'; $(id).disabled = step !== 'save'; });
    $('skipSave').hidden = step !== 'save';
    $('forgetSession').hidden = step !== 'unlock';
    const titles = { credentials: 'Sign in to Telegram', code: 'Confirm sign-in', password: 'Two-step verification', unlock: 'Unlock saved login', save: 'Save login' };
    const buttons = { credentials: 'Send code', code: 'Sign in', password: 'Sign in', unlock: 'Unlock', save: 'Save' };
    $('loginHeading').textContent = titles[step];
    $('loginSubmit').textContent = buttons[step];
    const focus = { credentials: 'apiId', code: 'code', password: 'password', unlock: 'unlockPassword', save: 'savePassword' };
    if ($('login').open) $(focus[step]).focus();
  }
  function clearSecrets() {
    ['apiId', 'apiHash', 'phone', 'code', 'password', 'unlockPassword', 'savePassword', 'saveConfirm'].forEach(id => { $(id).value = ''; });
    $('remember').checked = false;
    authPhone = ''; codeHash = ''; authenticatedUser = null;
  }
  function openLogin(after) {
    if ($('login').open) return;
    continueRefresh = after;
    generation++;
    clearSecrets();
    status('', false, 'loginStatus');
    const saved = hasSavedSession();
    $('loginHint').textContent = saved ? 'Enter the password for your saved login. Your API keys and Telegram code are not needed.' : 'Enter your application’s keys and phone number. Select the checkbox below to save your login.';
    setAuthStep(saved ? 'unlock' : 'credentials');
    $('login').showModal();
  }
  $('connect').addEventListener('click', () => openLogin());
  $('cancelLogin').addEventListener('click', () => $('login').close());
  $('login').addEventListener('close', () => {
    generation++;
    clearSecrets();
    pendingClient?.destroy().catch(() => {});
    pendingClient = null;
    ['loginSubmit', 'skipSave', 'forgetSession'].forEach(id => { $(id).disabled = false; });
    updateConnectionButtons();
  });

  function completeLogin(user, message = 'Signed in') {
    client = pendingClient;
    pendingClient = null;
    updateConnectionButtons();
    const auto = continueRefresh;
    $('login').close();
    status(`${message}: ${user.displayName || 'Telegram'}.`);
    auto?.();
  }
  function finishTelegramLogin(user) {
    if ($('remember').checked) {
      authenticatedUser = user;
      setAuthStep('save');
      $('loginHint').textContent = 'Signed in to Telegram. Set a separate password to encrypt your session in this browser.';
      status('', false, 'loginStatus');
    } else { completeLogin(user); }
  }
  $('skipSave').addEventListener('click', () => {
    if (authenticatedUser && pendingClient) completeLogin(authenticatedUser, 'Signed in without saving');
  });
  $('forgetSession').addEventListener('click', () => {
    try { forgetSavedSession(); }
    catch (error) { status(explainError(error), true, 'loginStatus'); return; }
    generation++;
    pendingClient?.destroy().catch(() => {});
    pendingClient = null;
    clearSecrets();
    setAuthStep('credentials');
    $('loginHint').textContent = 'Enter your application’s keys and phone number to sign in again.';
    status('The saved copy was removed. Revoke the old session in Telegram → Settings → Devices.', false, 'loginStatus');
    updateConnectionButtons();
  });
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('loginSubmit').disabled) return;
    const token = generation;
    const step = authStep;
    ['loginSubmit', 'skipSave', 'forgetSession'].forEach(id => { $(id).disabled = true; });
    status(step === 'save' ? 'Encrypting and saving…' : step === 'unlock' ? 'Unlocking…' : 'Connecting…', false, 'loginStatus');
    try {
      if (step === 'credentials') {
        if (!Number.isInteger(Number($('apiId').value)) || Number($('apiId').value) < 1 || Number($('apiId').value) > 2147483647 || !/^[0-9a-fA-F]{32}$/.test($('apiHash').value)) throw new UserFacingError('Check the numeric API ID and 32-character API hash.');
        if (!/^\+[\d\s()-]{7,24}$/.test($('phone').value.trim())) throw new UserFacingError('Enter your phone number with a country code, starting with +.');
        if (!globalThis.crypto?.subtle) throw new UserFacingError('WebCrypto is unavailable. Open the HTTPS site in a modern browser.');
        pendingClient?.destroy().catch(() => {});
        pendingClient = createClient(Number($('apiId').value), $('apiHash').value);
        authPhone = $('phone').value.trim();
        const sent = await auth.sendCode(pendingClient, authPhone);
        if (token !== generation) return;
        if (!sent.phoneCodeHash) { finishTelegramLogin(sent); return; }
        if (!['app', 'sms', 'call', 'email', 'sms_word', 'sms_phrase'].includes(sent.type)) throw new UserFacingError('Telegram requested an unsupported sign-in method.');
        codeHash = sent.phoneCodeHash;
        ['apiId', 'apiHash', 'phone'].forEach(id => { $(id).value = ''; });
        setAuthStep('code');
        const where = { app: 'in the Telegram app', sms: 'by SMS', call: 'in a phone call', email: 'by email', sms_word: 'by SMS', sms_phrase: 'by SMS' };
        $('loginHint').textContent = `Enter the code received ${where[sent.type]}. Do not share it.`;
        status('', false, 'loginStatus');
      } else if (step === 'code') {
        const code = $('code').value.trim();
        $('code').value = '';
        const user = await auth.signIn(pendingClient, authPhone, codeHash, code);
        if (token === generation) finishTelegramLogin(user);
      } else if (step === 'password') {
        const password = $('password').value;
        $('password').value = '';
        const user = await auth.password(pendingClient, password);
        if (token === generation) finishTelegramLogin(user);
      } else if (step === 'save') {
        const password = $('savePassword').value;
        if (password !== $('saveConfirm').value) throw new UserFacingError('The passwords do not match. Try again.');
        validateSavePassword(password);
        $('savePassword').value = ''; $('saveConfirm').value = '';
        const attempt = pendingClient;
        const session = await attempt.exportSession();
        const credentials = await attempt.getApiCredentials();
        if (token !== generation) return;
        const encrypted = await encryptSession({ apiId: credentials.id, apiHash: credentials.hash, session }, password);
        if (token !== generation) return;
        writeSavedSession(encrypted);
        completeLogin(authenticatedUser, 'Login saved in this browser');
      } else if (step === 'unlock') {
        const password = $('unlockPassword').value;
        $('unlockPassword').value = '';
        const data = await decryptSession(readSavedSession(), password);
        if (token !== generation) return;
        pendingClient = createClient(data.apiId, data.apiHash);
        const attempt = pendingClient;
        try {
          await attempt.importSession(data.session);
          if (token !== generation) return;
          const user = await auth.me(attempt);
          if (token === generation) completeLogin(user, 'Login unlocked');
        } catch (error) {
          await attempt.destroy().catch(() => {});
          if (pendingClient === attempt) pendingClient = null;
          throw error;
        }
      }
    } catch (error) {
      if (token !== generation) return;
      if ((error.text || error.message || '').includes('SESSION_PASSWORD_NEEDED')) {
        setAuthStep('password');
        $('loginHint').textContent = 'Two-step verification is enabled. Enter your 2FA password.';
        status('', false, 'loginStatus');
      } else { status(explainError(error), true, 'loginStatus'); }
    } finally {
      if (token === generation) ['loginSubmit', 'skipSave', 'forgetSession'].forEach(id => { $(id).disabled = false; });
    }
  });


  return {
    getClient: () => client,
    openLogin,
    async signOut() {
      let storageMessage = '';
      try { forgetSavedSession(); } catch (error) { storageMessage = explainError(error); }
      const old = client;
      client = null;
      let revoked = false;
      try { await auth.logout(old); revoked = true; } catch { /* Discard the local session even when offline. */ }
      await old.destroy().catch(() => {});
      updateConnectionButtons();
      const message = revoked ? 'Signed out of Telegram. Results were cleared from memory.'
        : 'Disconnected locally. Revoke the server session in Telegram → Settings → Devices.';
      return { message: message + (storageMessage ? ' ' + storageMessage : ' Saved login removed.'), error: !!storageMessage };
    },
  };
}
