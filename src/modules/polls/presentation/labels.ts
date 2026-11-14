import type { PollKind } from '../domain/models.ts';

export const POLL_LABELS: Record<PollKind, string> = {
  topic: 'Topic',
  date: 'Date',
  time: 'Time',
  place: 'Place',
};

export const SECTION_LABELS: Record<PollKind, string> = {
  topic: 'Topics',
  date: 'Date',
  time: 'Time',
  place: 'Places',
};
