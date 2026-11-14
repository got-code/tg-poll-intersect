export const POLL_KINDS = ['topic', 'date', 'time', 'place'] as const;
export type PollKind = (typeof POLL_KINDS)[number];
export type ParticipantNames = Record<string, string>;

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
  kind: PollKind;
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
  kind: Exclude<PollKind, 'date'>;
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
