import { isParticipantMinimum } from '../domain/polls.ts';

export type PollFilter = 'grouping' | 'none' | { pollId: string };

export interface ViewSettings {
  groupBy: string | null;
  filterBy: PollFilter;
  minimumParticipants: number;
}

export interface Preferences extends ViewSettings {
  links: string[];
}

export interface PreferencesStore {
  readPreferences(): Preferences;
  writePreferences(preferences: Preferences): boolean;
}

export const DEFAULT_PARTICIPANT_MINIMUM = 3;

export function resolveParticipantMinimum(value: number | undefined) {
  return value !== undefined && isParticipantMinimum(value) ? value : DEFAULT_PARTICIPANT_MINIMUM;
}

export function defaultPreferences(): Preferences {
  return {
    links: [''],
    groupBy: null,
    filterBy: 'grouping',
    minimumParticipants: DEFAULT_PARTICIPANT_MINIMUM,
  };
}
