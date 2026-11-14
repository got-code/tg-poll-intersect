import { filterTopics } from '../domain/polls.ts';
import { UserFacingError } from '../../../application/errors.ts';
import { matchesSourceLinks } from './results.ts';
import type { Intersection, PollKind } from '../domain/models.ts';
import type { PollResult } from './results.ts';

export interface ExportRow {
  date: string;
  section: PollKind;
  option: string;
  total: number;
  explicit: number;
  implicit: number;
  participants: string[];
  implicitParticipants: string[];
}

export function canExportResults(
  result: PollResult,
  identities: readonly string[],
  minimum: number,
) {
  return matchesSourceLinks(result, identities) && filterTopics(result.groups, minimum).length > 0;
}

export function exportResults(
  result: PollResult,
  identities: readonly string[],
  minimum: number,
): ExportRow[] {
  if (!matchesSourceLinks(result, identities))
    throw new UserFacingError('Links changed. Refresh the results.');
  const groups = filterTopics(result.groups, minimum);
  if (!groups.length) throw new UserFacingError('No results match the topic minimum.');
  const name = (id: string) => result.names[id] || 'Unnamed participant';
  const row = (
    date: string,
    section: PollKind,
    option: string,
    votes: Intersection,
  ): ExportRow => ({
    date,
    section,
    option,
    total: votes.ids.length,
    explicit: votes.explicitIds.length,
    implicit: votes.implicitIds.length,
    participants: votes.ids.map(name),
    implicitParticipants: votes.implicitIds.map(name),
  });
  return groups.flatMap((group) => [
    row(group.date, 'date', group.date, group),
    ...group.sections.flatMap((section) =>
      section.options.map((option) => row(group.date, section.kind, option.text, option)),
    ),
  ]);
}
