import { UserFacingError } from '../domain/errors.ts';
import { createAuthView } from './auth-view.ts';
import { $, status } from './dom.ts';
import type {
  AuthSession,
  AuthStep,
  CodeDelivery,
  LoginCredentials,
  LoginKind,
  LoginMethod,
  LoginResult,
} from '../application/auth-contracts.ts';

export function createAuthController({
  session,
  explainError,
}: {
  session: AuthSession;
  explainError: (error: unknown) => string;
}) {
  const view = createAuthView();
  let authStep: AuthStep = 'credentials';
  let loginMethod: LoginMethod = 'phone';
  let activeAction: object | null = null;
  let continueRefresh: (() => void | Promise<void>) | undefined;
  const credentialsHint = () =>
    loginMethod === 'qr'
      ? 'Sign in with Telegram on another device.'
      : 'Sign in with your phone number.';
  const updateConnection = () =>
    view.updateConnection(session.isConnected(), session.hasSavedLogin());
  const setStep = (step: AuthStep) => {
    authStep = step;
    view.setStep(step, loginMethod);
  };

  function cancelPendingLogin() {
    activeAction = null;
    session.cancel();
    view.clearQr();
  }

  function openLogin(after?: () => void | Promise<void>) {
    if ($('login').open) return;
    continueRefresh = after;
    view.clearSecrets();
    status('', false, 'loginStatus');
    const saved = session.hasSavedLogin();
    $('loginHint').textContent = saved
      ? 'Enter the password you chose for this browser.'
      : credentialsHint();
    setStep(saved ? 'unlock' : 'credentials');
    $('login').showModal();
  }

  function showResult(result: LoginResult) {
    if (!result) return;
    if (result.step === 'complete') {
      updateConnection();
      const after = continueRefresh;
      $('login').close();
      const message: Record<LoginKind, string> = {
        'signed-in': 'Signed in',
        saved: 'Login saved in this browser',
        unlocked: 'Login unlocked',
        memory: 'Signed in without saving',
      };
      status(`${message[result.kind]}: ${result.user.displayName || 'Telegram'}.`);
      void after?.();
      return;
    }
    if (result.step === 'code' || result.step === 'password')
      view.clearInputs(['apiId', 'apiHash', 'phone']);
    setStep(result.step);
    const where: Record<CodeDelivery, string> = {
      app: 'in the Telegram app',
      sms: 'by SMS',
      call: 'in a phone call',
      email: 'by email',
      sms_word: 'by SMS',
      sms_phrase: 'by SMS',
    };
    $('loginHint').textContent =
      result.step === 'code'
        ? `Enter the code received ${where[result.delivery]}. Do not share it.`
        : result.step === 'password'
          ? 'Two-step verification is enabled. Enter your 2FA password.'
          : 'Signed in to Telegram. Set a separate password to encrypt your session in this browser.';
    status('', false, 'loginStatus');
  }

  async function submit() {
    const action = (activeAction = {});
    const step = authStep;
    view.setBusy(true);
    status(
      step === 'save' ? 'Encrypting and saving…' : step === 'unlock' ? 'Unlocking…' : 'Connecting…',
      false,
      'loginStatus',
    );
    try {
      let result: LoginResult = null;
      if (step === 'credentials') {
        const credentials: LoginCredentials = {
          apiId: $('apiId').value,
          apiHash: $('apiHash').value,
          phone: $('phone').value,
          method: loginMethod,
          remember: $('remember').checked,
          onUrlUpdated: view.showQr,
          onQrScanned() {
            view.clearQr();
            status('QR code accepted. Completing sign-in…', false, 'loginStatus');
          },
        };
        if (loginMethod === 'qr') {
          setStep('qr');
          $('loginHint').textContent = 'Waiting for Telegram to generate a QR code…';
        }
        result = await session.begin(credentials);
      } else if (step === 'code') {
        result = await session.submitCode(view.takeSecret('code'));
      } else if (step === 'password') {
        result = await session.submitPassword(view.takeSecret('password'));
      } else if (step === 'save') {
        const password = $('savePassword').value;
        if (password !== $('saveConfirm').value)
          throw new UserFacingError('The passwords do not match. Try again.');
        session.validateSavePassword(password);
        view.clearInputs(['savePassword', 'saveConfirm']);
        result = await session.save(password);
      } else if (step === 'unlock') {
        result = await session.unlock(view.takeSecret('unlockPassword'));
      }
      if (activeAction === action) showResult(result);
    } catch (error) {
      if (activeAction !== action) return;
      if (authStep === 'qr') {
        cancelPendingLogin();
        view.setBusy(false);
        setStep('credentials');
        $('loginHint').textContent = credentialsHint();
      }
      status(explainError(error), true, 'loginStatus');
    } finally {
      if (activeAction === action) view.setBusy(false);
    }
  }

  updateConnection();
  $('connect').addEventListener('click', () => openLogin());
  $('cancelLogin').addEventListener('click', () => $('login').close());
  $('login').addEventListener('close', () => {
    cancelPendingLogin();
    continueRefresh = undefined;
    view.clearSecrets();
    view.setBusy(false);
    updateConnection();
  });
  for (const method of ['phone', 'qr'] as const) {
    $(`${method}Login`).addEventListener('click', () => {
      if (!['credentials', 'qr'].includes(authStep) || loginMethod === method) return;
      cancelPendingLogin();
      loginMethod = method;
      setStep('credentials');
      $('loginHint').textContent = credentialsHint();
      view.setBusy(false);
      status('', false, 'loginStatus');
    });
  }
  $('skipSave').addEventListener('click', () => showResult(session.skipSaving()));
  $('forgetSession').addEventListener('click', () => {
    try {
      session.forgetSavedLogin();
    } catch (error) {
      status(explainError(error), true, 'loginStatus');
      return;
    }
    cancelPendingLogin();
    view.clearSecrets();
    setStep('credentials');
    $('loginHint').textContent = credentialsHint();
    status(
      'The saved copy was removed. Revoke the old session in Telegram → Settings → Devices.',
      false,
      'loginStatus',
    );
    updateConnection();
  });
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Handles its own errors.
  $('loginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('loginSubmit').disabled && authStep !== 'qr') return submit();
  });

  return {
    isConnected: session.isConnected,
    hasSavedLogin: session.hasSavedLogin,
    openLogin,
    async signOut() {
      const { revoked, storageError } = await session.signOut();
      updateConnection();
      const message = revoked
        ? 'Signed out of Telegram. Results were cleared from memory.'
        : 'Disconnected locally. Revoke the server session in Telegram → Settings → Devices.';
      return {
        message:
          message + (storageError ? ' ' + explainError(storageError) : ' Saved login removed.'),
        error: !!storageError,
      };
    },
  };
}
