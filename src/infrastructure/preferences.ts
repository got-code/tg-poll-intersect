import { DEFAULT_TOPIC_MINIMUM, topicMinimum } from '../domain/polls.ts';
import type { Preferences } from '../domain/models.ts';

export const PREFERENCES_KEY = 'poll-intersections.preferences.v1';

export function readPreferences(): Preferences {
  const defaults = { links: ['', '', '', ''], topicMinimum: DEFAULT_TOPIC_MINIMUM };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null');
    const saved = typeof raw === 'object' && raw !== null ? raw : {};
    return {
      links:
        'links' in saved &&
        Array.isArray(saved.links) &&
        saved.links.length === 4 &&
        saved.links.every((value: unknown) => typeof value === 'string')
          ? saved.links
          : defaults.links,
      topicMinimum:
        'topicMinimum' in saved && typeof saved.topicMinimum === 'number'
          ? topicMinimum(saved.topicMinimum)
          : defaults.topicMinimum,
    };
  } catch {
    return defaults;
  }
}

export function writePreferences(preferences: Preferences) {
  try {
    const serialized = JSON.stringify(preferences);
    localStorage.setItem(PREFERENCES_KEY, serialized);
    return localStorage.getItem(PREFERENCES_KEY) === serialized;
  } catch {
    return false;
  }
}
