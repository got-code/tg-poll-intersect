export const POLL_LABELS = ['Topic', 'Date', 'Time', 'Place'] as const;
export type PollLabel = (typeof POLL_LABELS)[number];
export type ParticipantNames = Record<string, string>;

export interface PollLink {
  peer: string | number;
  messageId: number;
  url: string;
}

export interface PollOption {
  text: string;
  voters: string[];
}

export interface Poll {
  title?: string;
  options: PollOption[];
  votedAt?: Record<string, number | null>;
}

export interface PollData {
  polls: Poll[];
  names: ParticipantNames;
}

export interface PersonVote {
  label: PollLabel;
  voted: boolean;
  at: number | null;
}

export interface Intersection {
  ids: string[];
  explicitIds: string[];
  implicitIds: string[];
}

export interface GroupOption extends Intersection {
  text: string;
}

export interface PollSection {
  label: string;
  pollLabel: PollLabel;
  options: GroupOption[];
}

export interface DateGroup extends Intersection {
  date: string;
  votesByPerson: Record<string, PersonVote[]>;
  bestTopicCount: number;
  bestTopicExplicitCount: number;
  bestTopicImplicitCount: number;
  sections: PollSection[];
}

export interface Preferences {
  links: string[];
  topicMinimum: number;
}

export interface PreferencesStore {
  readPreferences(): Preferences;
  writePreferences(preferences: Preferences): boolean;
}
