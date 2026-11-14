import { elements } from '../../../presentation/dom.ts';

type InputId = `link${number}` | 'topicMinimum';
type ButtonId = 'refresh' | 'demo' | 'export' | 'clearLinks';
type TextId =
  | `linkHint${number}`
  | 'pollLinksToggle'
  | 'pollLinksCount'
  | 'preferencesHint'
  | 'resultMeta'
  | 'empty'
  | 'demoLabel'
  | 'resultFooter'
  | 'rows';
type PollElements = Record<InputId, HTMLInputElement> &
  Record<ButtonId, HTMLButtonElement> &
  Record<TextId, HTMLElement> & {
    pollForm: HTMLFormElement;
    pollLinks: HTMLDetailsElement;
  };
export const $ = elements<PollElements>();
