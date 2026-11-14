import { isTopicMinimum } from '../domain/polls.ts';
import { POLL_KINDS } from '../domain/models.ts';

export interface Preferences {
  links: string[];
  topicMinimum: number;
}

export interface PreferencesStore {
  readPreferences(): Preferences;
  writePreferences(preferences: Preferences): boolean;
}

export const DEFAULT_TOPIC_MINIMUM = 3;

export function resolveTopicMinimum(value: number | undefined) {
  return value !== undefined && isTopicMinimum(value) ? value : DEFAULT_TOPIC_MINIMUM;
}

export function defaultPreferences(): Preferences {
  return { links: POLL_KINDS.map(() => ''), topicMinimum: DEFAULT_TOPIC_MINIMUM };
}
