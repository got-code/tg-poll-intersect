export type InputId =
  | `link${number}`
  | 'topicMinimum'
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
  | 'refresh'
  | 'demo'
  | 'export'
  | 'clearLinks'
  | 'phoneLogin'
  | 'qrLogin'
  | 'loginSubmit'
  | 'skipSave'
  | 'forgetSession'
  | 'cancelLogin';
type TextId =
  | `linkHint${number}`
  | 'pollLinksToggle'
  | 'pollLinksCount'
  | 'preferencesHint'
  | 'status'
  | 'resultMeta'
  | 'empty'
  | 'demoLabel'
  | 'resultFooter'
  | 'rows'
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
type AppElements = Record<InputId, HTMLInputElement> &
  Record<ButtonId, HTMLButtonElement> &
  Record<TextId, HTMLElement> & {
    login: HTMLDialogElement;
    loginForm: HTMLFormElement;
    pollForm: HTMLFormElement;
    pollLinks: HTMLDetailsElement;
    qrCode: HTMLImageElement;
  };
export type ElementId = keyof AppElements;

export function $<Id extends ElementId>(id: Id): AppElements[Id] {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing application element: ${id}`);
  // IDs and element types are defined together in the owned HTML template.
  return node as AppElements[Id];
}

export function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className = '',
  text?: string | number,
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

export function status(text: string, error = false, id: ElementId = 'status') {
  $(id).textContent = text;
  $(id).classList.toggle('error', error);
}
