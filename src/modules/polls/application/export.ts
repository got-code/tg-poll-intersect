import { UserFacingError } from '../../../application/errors.ts';
import { matchesSourceLinks, selectResultGroups } from './results.ts';
import type { Intersection } from '../domain/models.ts';
import type { PollResult } from './results.ts';
import type { ViewSettings } from './preferences.ts';

export interface ExportRow {
  groupPoll: number;
  groupOption: string;
  poll: number;
  option: string;
  total: number;
  explicit: number;
  implicit: number;
  participants: string[];
  implicitParticipants: string[];
}

export interface ExportData {
  polls: { title?: string }[];
  rows: ExportRow[];
}

export function canExportResults(
  result: PollResult,
  identities: readonly string[],
  settings: ViewSettings,
) {
  return matchesSourceLinks(result, identities) && selectResultGroups(result, settings).length > 0;
}

export function exportResults(
  result: PollResult,
  identities: readonly string[],
  settings: ViewSettings,
): ExportData {
  if (!matchesSourceLinks(result, identities))
    throw new UserFacingError('Links changed. Load the polls again.');
  const groups = selectResultGroups(result, settings);
  if (!groups.length) throw new UserFacingError('No results match the participant minimum.');
  const name = (id: string) => result.names[id] || 'Unnamed participant';
  const pollIndex = new Map(result.polls.map((poll, index) => [poll.id, index]));
  const row = (
    groupPoll: string,
    groupOption: string,
    poll: string,
    option: string,
    votes: Intersection,
  ): ExportRow => ({
    groupPoll: pollIndex.get(groupPoll)!,
    groupOption,
    poll: pollIndex.get(poll)!,
    option,
    total: votes.ids.length,
    explicit: votes.explicitIds.length,
    implicit: votes.implicitIds.length,
    participants: votes.ids.map(name),
    implicitParticipants: votes.implicitIds.map(name),
  });
  return {
    polls: result.polls.map(({ title }) => ({ title })),
    rows: groups.flatMap((group) => [
      row(group.pollId, group.option, group.pollId, group.option, group),
      ...group.sections.flatMap((section) =>
        section.options.map((option) =>
          row(group.pollId, group.option, section.pollId, option.text, option),
        ),
      ),
    ]),
  };
}
