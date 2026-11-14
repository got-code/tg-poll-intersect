import encodeQR from 'qr';
import { createStatus } from '../../../presentation/dom.ts';
import { $ } from './dom.ts';
import type { ElementId, InputId } from './dom.ts';
import type { LoginMethod } from '../application/contracts.ts';

export type AuthStep = 'credentials' | 'qr' | 'code' | 'password' | 'unlock' | 'save';

export function createAuthView() {
  const status = createStatus($('loginStatus'));
  let qrExpiryTimer: ReturnType<typeof setTimeout> | undefined;

  function setFields(container: ElementId, fields: readonly InputId[], visible: boolean) {
    $(container).hidden = !visible;
    fields.forEach((id) => {
      $(id).required = visible;
      $(id).disabled = !visible;
    });
  }

  function clearInputs(ids: readonly InputId[]) {
    ids.forEach((id) => {
      $(id).value = '';
    });
  }

  function clearQr() {
    clearTimeout(qrExpiryTimer);
    qrExpiryTimer = undefined;
    $('qrCode').hidden = true;
    $('qrCode').removeAttribute('src');
  }

  function setStep(step: AuthStep, method: LoginMethod) {
    $('loginMethods').hidden = !['credentials', 'qr'].includes(step);
    $('phoneLogin').setAttribute('aria-pressed', String(method === 'phone'));
    $('qrLogin').setAttribute('aria-pressed', String(method === 'qr'));
    setFields('credentials', ['apiId', 'apiHash'], step === 'credentials');
    setFields('phoneLabel', ['phone'], step === 'credentials' && method === 'phone');
    setFields('codeLabel', ['code'], step === 'code');
    setFields('passwordLabel', ['password'], step === 'password');
    setFields('unlockLabel', ['unlockPassword'], step === 'unlock');
    setFields('saveFields', ['savePassword', 'saveConfirm'], step === 'save');
    $('remember').disabled = step !== 'credentials';
    $('qrFields').hidden = step !== 'qr';
    if (step !== 'qr') clearQr();
    $('skipSave').hidden = step !== 'save';
    $('forgetSession').hidden = step !== 'unlock';
    const titles: Record<AuthStep, string> = {
      credentials: 'Sign in to Telegram',
      qr: 'Scan with Telegram',
      code: 'Confirm sign-in',
      password: 'Two-step verification',
      unlock: 'Unlock saved login',
      save: 'Save login',
    };
    const buttons: Partial<Record<AuthStep, string>> = {
      credentials: method === 'qr' ? 'Show QR code' : 'Send code',
      code: 'Sign in',
      password: 'Sign in',
      unlock: 'Unlock',
      save: 'Save',
    };
    $('loginHeading').textContent = titles[step];
    $('loginSubmit').hidden = step === 'qr';
    $('loginSubmit').textContent = buttons[step] ?? 'Sign in';
    const credentialsFocus = !$('apiId').value
      ? 'apiId'
      : !$('apiHash').value
        ? 'apiHash'
        : method === 'phone'
          ? 'phone'
          : 'loginSubmit';
    const focus: Record<AuthStep, ElementId> = {
      credentials: credentialsFocus,
      qr: 'qrLogin',
      code: 'code',
      password: 'password',
      unlock: 'unlockPassword',
      save: 'savePassword',
    };
    if ($('login').open) $(focus[step]).focus();
  }

  function showQr(url: string, expires: Date) {
    clearQr();
    const remaining = expires.getTime() - Date.now();
    if (remaining <= 0) return;
    $('qrCode').src = encodeQR(url, 'data-url', { border: 4, scale: 6 });
    $('qrCode').hidden = false;
    $('loginHint').textContent = 'The QR code refreshes automatically.';
    status('', false);
    qrExpiryTimer = setTimeout(() => {
      clearQr();
      status('Updating QR code…', false);
    }, remaining);
  }

  return {
    setStep,
    clearInputs,
    clearQr,
    showQr,
    setBusy(busy: boolean) {
      (['loginSubmit', 'skipSave', 'forgetSession'] as const).forEach((id) => {
        $(id).disabled = busy;
      });
    },
    takeSecret(id: InputId) {
      const value = $(id).value;
      $(id).value = '';
      return value;
    },
    clearSecrets() {
      clearInputs([
        'apiId',
        'apiHash',
        'phone',
        'code',
        'password',
        'unlockPassword',
        'savePassword',
        'saveConfirm',
      ]);
      $('remember').checked = false;
    },
    updateConnection(connected: boolean, saved: boolean) {
      $('connect').hidden = connected;
      $('connect').textContent = saved ? 'Unlock' : 'Sign in to Telegram';
      $('disconnect').hidden = !connected;
    },
  };
}
