import { UserFacingError } from '../domain/errors.mjs';
import encodeQR from 'qr';
import { auth, createClient, explainError } from '../infrastructure/telegram.mjs';
import { hasSavedSession, readSavedSession, writeSavedSession, forgetSavedSession, encryptSession, decryptSession, validateSavePassword } from '../infrastructure/session.mjs';
import { $, status } from './dom.mjs';

export function createAuthController() {
  let client = null, pendingClient = null, authStep = 'credentials';
  let authPhone = '', codeHash = '', generation = 0;
  let continueRefresh = null, authenticatedUser = null;
  let loginMethod = 'phone', qrAbort = null, qrExpiryTimer = null;

  function setFields(container, fields, visible) {
    $(container).hidden = !visible;
    fields.forEach(id => { $(id).required = visible; $(id).disabled = !visible; });
  }
  function setBusy(busy) {
    ['loginSubmit', 'skipSave', 'forgetSession'].forEach(id => { $(id).disabled = busy; });
  }
  function clearInputs(ids) {
    ids.forEach(id => { $(id).value = ''; });
  }
  function takeSecret(id) {
    const value = $(id).value;
    $(id).value = '';
    return value;
  }
  function clearQr() {
    clearTimeout(qrExpiryTimer);
    qrExpiryTimer = null;
    $('qrCode').hidden = true;
    $('qrCode').removeAttribute('src');
  }
  function cancelPendingLogin() {
    generation++;
    qrAbort?.abort();
    qrAbort = null;
    clearQr();
    pendingClient?.destroy().catch(() => {});
    pendingClient = null;
  }
  function credentialsHint() {
    return loginMethod === 'qr'
      ? 'Sign in with Telegram on another device.'
      : 'Sign in with your phone number.';
  }

  function updateConnectionButtons() {
    const saved = hasSavedSession();
    $('connect').hidden = !!client;
    $('connect').textContent = saved ? 'Unlock' : 'Sign in to Telegram';
    $('disconnect').hidden = !client;
  }
  updateConnectionButtons();

  function setAuthStep(step) {
    authStep = step;
    $('loginMethods').hidden = !['credentials', 'qr'].includes(step);
    $('phoneLogin').setAttribute('aria-pressed', String(loginMethod === 'phone'));
    $('qrLogin').setAttribute('aria-pressed', String(loginMethod === 'qr'));
    setFields('credentials', ['apiId', 'apiHash'], step === 'credentials');
    setFields('phoneLabel', ['phone'], step === 'credentials' && loginMethod === 'phone');
    setFields('codeLabel', ['code'], step === 'code');
    setFields('passwordLabel', ['password'], step === 'password');
    setFields('unlockLabel', ['unlockPassword'], step === 'unlock');
    setFields('saveFields', ['savePassword', 'saveConfirm'], step === 'save');
    $('remember').disabled = step !== 'credentials';
    $('qrFields').hidden = step !== 'qr';
    if (step !== 'qr') clearQr();
    $('skipSave').hidden = step !== 'save';
    $('forgetSession').hidden = step !== 'unlock';
    const titles = { credentials: 'Sign in to Telegram', qr: 'Scan with Telegram', code: 'Confirm sign-in', password: 'Two-step verification', unlock: 'Unlock saved login', save: 'Save login' };
    const buttons = { credentials: loginMethod === 'qr' ? 'Show QR code' : 'Send code', code: 'Sign in', password: 'Sign in', unlock: 'Unlock', save: 'Save' };
    $('loginHeading').textContent = titles[step];
    $('loginSubmit').hidden = step === 'qr';
    $('loginSubmit').textContent = buttons[step] ?? 'Sign in';
    const credentialsFocus = !$('apiId').value ? 'apiId' : !$('apiHash').value ? 'apiHash' : loginMethod === 'phone' ? 'phone' : 'loginSubmit';
    const focus = { credentials: credentialsFocus, qr: 'qrLogin', code: 'code', password: 'password', unlock: 'unlockPassword', save: 'savePassword' };
    if ($('login').open) $(focus[step]).focus();
  }
  function clearSecrets() {
    clearInputs(['apiId', 'apiHash', 'phone', 'code', 'password', 'unlockPassword', 'savePassword', 'saveConfirm']);
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
    $('loginHint').textContent = saved ? 'Enter the password you chose for this browser.' : credentialsHint();
    setAuthStep(saved ? 'unlock' : 'credentials');
    $('login').showModal();
  }
  $('connect').addEventListener('click', () => openLogin());
  $('cancelLogin').addEventListener('click', () => $('login').close());
  $('login').addEventListener('close', () => {
    cancelPendingLogin();
    clearSecrets();
    setBusy(false);
    updateConnectionButtons();
  });
  for (const method of ['phone', 'qr']) {
    $(`${method}Login`).addEventListener('click', () => {
      if (!['credentials', 'qr'].includes(authStep) || loginMethod === method) return;
      cancelPendingLogin();
      loginMethod = method;
      setAuthStep('credentials');
      $('loginHint').textContent = credentialsHint();
      setBusy(false);
      status('', false, 'loginStatus');
    });
  }

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
    cancelPendingLogin();
    clearSecrets();
    setAuthStep('credentials');
    $('loginHint').textContent = credentialsHint();
    status('The saved copy was removed. Revoke the old session in Telegram → Settings → Devices.', false, 'loginStatus');
    updateConnectionButtons();
  });
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('loginSubmit').disabled || authStep === 'qr') return;
    const token = generation;
    const step = authStep;
    setBusy(true);
    status(step === 'save' ? 'Encrypting and saving…' : step === 'unlock' ? 'Unlocking…' : 'Connecting…', false, 'loginStatus');
    try {
      if (step === 'credentials') {
        if (!Number.isInteger(Number($('apiId').value)) || Number($('apiId').value) < 1 || Number($('apiId').value) > 2147483647 || !/^[0-9a-fA-F]{32}$/.test($('apiHash').value)) throw new UserFacingError('Check the numeric API ID and 32-character API hash.');
        if (loginMethod === 'phone' && !/^\+[\d\s()-]{7,24}$/.test($('phone').value.trim())) throw new UserFacingError('Enter your phone number with a country code, starting with +.');
        if (!globalThis.crypto?.subtle) throw new UserFacingError('WebCrypto is unavailable. Open the HTTPS site in a modern browser.');
        pendingClient?.destroy().catch(() => {});
        pendingClient = createClient(Number($('apiId').value), $('apiHash').value, { qrLogin: loginMethod === 'qr' });
        if (loginMethod === 'qr') {
          qrAbort = new AbortController();
          setAuthStep('qr');
          $('loginHint').textContent = 'Waiting for Telegram to generate a QR code…';
          const user = await auth.qr(pendingClient, {
            abortSignal: qrAbort.signal,
            onUrlUpdated(url, expires) {
              if (token !== generation) return;
              clearQr();
              const remaining = expires.getTime() - Date.now();
              if (remaining <= 0) return;
              $('qrCode').src = encodeQR(url, 'data-url', { border: 4, scale: 6 });
              $('qrCode').hidden = false;
              $('loginHint').textContent = 'The QR code refreshes automatically.';
              status('', false, 'loginStatus');
              qrExpiryTimer = setTimeout(() => {
                if (token !== generation) return;
                clearQr();
                status('Updating QR code…', false, 'loginStatus');
              }, remaining);
            },
            onQrScanned() {
              if (token !== generation) return;
              clearQr();
              status('QR code accepted. Completing sign-in…', false, 'loginStatus');
            },
          });
          if (token === generation) finishTelegramLogin(user);
          return;
        }
        authPhone = $('phone').value.trim();
        const sent = await auth.sendCode(pendingClient, authPhone);
        if (token !== generation) return;
        if (!sent.phoneCodeHash) { finishTelegramLogin(sent); return; }
        if (!['app', 'sms', 'call', 'email', 'sms_word', 'sms_phrase'].includes(sent.type)) throw new UserFacingError('Telegram requested an unsupported sign-in method.');
        codeHash = sent.phoneCodeHash;
        clearInputs(['apiId', 'apiHash', 'phone']);
        setAuthStep('code');
        const where = { app: 'in the Telegram app', sms: 'by SMS', call: 'in a phone call', email: 'by email', sms_word: 'by SMS', sms_phrase: 'by SMS' };
        $('loginHint').textContent = `Enter the code received ${where[sent.type]}. Do not share it.`;
        status('', false, 'loginStatus');
      } else if (step === 'code') {
        const code = takeSecret('code').trim();
        const user = await auth.signIn(pendingClient, authPhone, codeHash, code);
        if (token === generation) finishTelegramLogin(user);
      } else if (step === 'password') {
        const password = takeSecret('password');
        const user = await auth.password(pendingClient, password);
        if (token === generation) finishTelegramLogin(user);
      } else if (step === 'save') {
        const password = $('savePassword').value;
        if (password !== $('saveConfirm').value) throw new UserFacingError('The passwords do not match. Try again.');
        validateSavePassword(password);
        clearInputs(['savePassword', 'saveConfirm']);
        const attempt = pendingClient;
        const session = await attempt.exportSession();
        const credentials = await attempt.getApiCredentials();
        if (token !== generation) return;
        const encrypted = await encryptSession({ apiId: credentials.id, apiHash: credentials.hash, session }, password);
        if (token !== generation) return;
        writeSavedSession(encrypted);
        completeLogin(authenticatedUser, 'Login saved in this browser');
      } else if (step === 'unlock') {
        const password = takeSecret('unlockPassword');
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
        clearInputs(['apiId', 'apiHash', 'phone']);
        setAuthStep('password');
        $('loginHint').textContent = 'Two-step verification is enabled. Enter your 2FA password.';
        status('', false, 'loginStatus');
      } else {
        if (authStep === 'qr') {
          cancelPendingLogin();
          setBusy(false);
          setAuthStep('credentials');
          $('loginHint').textContent = credentialsHint();
        }
        status(explainError(error), true, 'loginStatus');
      }
    } finally {
      if (token === generation) setBusy(false);
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
