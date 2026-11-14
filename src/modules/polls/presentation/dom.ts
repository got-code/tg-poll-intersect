import { elements } from '../../../presentation/dom.ts';

type ButtonId =
  'refresh' | 'demo' | 'demoExample' | 'export' | 'clearLinks' | 'addPoll' | 'pollLinksToggle';
type TextId =
  | 'pollLinks'
  | 'pollLoadActions'
  | 'pollActions'
  | 'pollLinksCount'
  | 'pollLinkFields'
  | 'preferencesHint'
  | 'resultHeading'
  | 'resultMeta'
  | 'empty'
  | 'demoLabel'
  | 'resultFooter'
  | 'rows';
type PollElements = Record<ButtonId, HTMLButtonElement> &
  Record<TextId, HTMLElement> & {
    minimumParticipants: HTMLInputElement;
    groupBy: HTMLSelectElement;
    filterBy: HTMLSelectElement;
    pollForm: HTMLFormElement;
  };
export const $ = elements<PollElements>();
