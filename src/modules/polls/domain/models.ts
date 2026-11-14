export type ParticipantNames = Record<string, string>;

export interface PollOption {
  text: string;
  voters: string[];
}

export interface Poll {
  id: string;
  title?: string;
  options: PollOption[];
  votedAt?: Record<string, number | null>;
}

export interface PollData {
  polls: Poll[];
  names: ParticipantNames;
}

export interface PersonVote {
  pollId: string;
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
  pollId: string;
  options: GroupOption[];
}

export interface PollGroup extends Intersection {
  pollId: string;
  option: string;
  votesByPerson: Record<string, PersonVote[]>;
  sections: PollSection[];
}
