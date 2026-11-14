import { elements } from '../../../presentation/dom.ts';

export type InputId =
  | 'apiId'
  | 'apiHash'
  | 'phone'
  | 'code'
  | 'password'
  | 'unlockPassword'
  | 'savePassword'
  | 'saveConfirm'
  | 'remember';
type ButtonId =
  | 'connect'
  | 'disconnect'
  | 'phoneLogin'
  | 'qrLogin'
  | 'loginSubmit'
  | 'skipSave'
  | 'forgetSession'
  | 'cancelLogin';
type TextId =
  | 'loginHeading'
  | 'loginHint'
  | 'loginStatus'
  | 'credentials'
  | 'phoneLabel'
  | 'codeLabel'
  | 'passwordLabel'
  | 'unlockLabel'
  | 'saveFields'
  | 'loginMethods'
  | 'qrFields';
type AuthElements = Record<InputId, HTMLInputElement> &
  Record<ButtonId, HTMLButtonElement> &
  Record<TextId, HTMLElement> & {
    login: HTMLDialogElement;
    loginForm: HTMLFormElement;
    qrCode: HTMLImageElement;
  };
export type ElementId = keyof AuthElements;
export const $ = elements<AuthElements>();
