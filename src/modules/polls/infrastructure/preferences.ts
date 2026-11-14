import { defaultPreferences, resolveParticipantMinimum } from '../application/preferences.ts';
import { isRecord } from '../../../infrastructure/validation.ts';
import type { Preferences } from '../application/preferences.ts';

export const PREFERENCES_KEY = 'poll-intersections.preferences.v1';

export function readPreferences(): Preferences {
  const defaults = defaultPreferences();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null');
    const saved = isRecord(raw) ? raw : {};
    return {
      links:
        'links' in saved &&
        Array.isArray(saved.links) &&
        saved.links.length > 0 &&
        saved.links.every((value: unknown) => typeof value === 'string')
          ? saved.links
          : defaults.links,
      groupBy:
        typeof saved.groupBy === 'string' && saved.groupBy ? saved.groupBy : defaults.groupBy,
      filterBy:
        saved.filterBy === 'none' || saved.filterBy === 'grouping'
          ? saved.filterBy
          : isRecord(saved.filterBy) &&
              typeof saved.filterBy.pollId === 'string' &&
              saved.filterBy.pollId
            ? { pollId: saved.filterBy.pollId }
            : defaults.filterBy,
      minimumParticipants: resolveParticipantMinimum(
        typeof saved.minimumParticipants === 'number' ? saved.minimumParticipants : undefined,
      ),
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
