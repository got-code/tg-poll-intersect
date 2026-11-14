import { groupPolls, filterGroups, validatePolls } from '../domain/polls.ts';
import { linkIdentity, readPollLinks } from './links.ts';
import type { ParticipantNames, Poll, PollData } from '../domain/models.ts';
import type { ViewSettings } from './preferences.ts';
import { DEFAULT_PARTICIPANT_MINIMUM } from './preferences.ts';
import { UserFacingError } from '../../../application/errors.ts';
import type { PollLink } from './links.ts';
import type { PollProgress, PollSource } from './source.ts';

export interface PollResult {
  polls: Poll[];
  names: ParticipantNames;
  kind: 'live' | 'demo';
  sourceLinks: string[];
  updatedAt: Date;
}

export function resolveViewSettings(polls: readonly Poll[], settings: ViewSettings): ViewSettings {
  const hasPoll = (id: string | null) => polls.some((poll) => poll.id === id);
  return {
    ...settings,
    groupBy: hasPoll(settings.groupBy) ? settings.groupBy : (polls[0]?.id ?? null),
    filterBy:
      typeof settings.filterBy === 'object' && !hasPoll(settings.filterBy.pollId)
        ? 'grouping'
        : settings.filterBy,
  };
}

export function selectResultGroups(result: PollResult, settings: ViewSettings) {
  const resolved = resolveViewSettings(result.polls, settings);
  const groupBy = resolved.groupBy;
  if (groupBy === null) throw new UserFacingError('Load at least one poll first.');
  const filterBy =
    resolved.filterBy === 'none'
      ? null
      : resolved.filterBy === 'grouping'
        ? groupBy
        : resolved.filterBy.pollId;
  return filterGroups(groupPolls(result.polls, groupBy), filterBy, resolved.minimumParticipants);
}

export function matchesSourceLinks(result: PollResult, identities: readonly string[]) {
  return (
    result.kind === 'demo' ||
    (result.sourceLinks.length === identities.length &&
      result.sourceLinks.every((identity, index) => identity === identities[index]))
  );
}

export function createPollResults({ source, demo }: { source: PollSource; demo: () => PollData }) {
  function summarize(data: PollData, kind: PollResult['kind'], links: readonly PollLink[] = []) {
    validatePolls(data.polls);
    if (kind === 'live' && data.polls.length !== links.length)
      throw new UserFacingError('Some polls are missing. Load the polls again.');
    return {
      polls: data.polls,
      names: data.names,
      kind,
      sourceLinks: links.map(linkIdentity),
      updatedAt: new Date(),
    } satisfies PollResult;
  }

  return {
    async load(links: readonly PollLink[], progress: (event: PollProgress) => void) {
      const validated = readPollLinks(links.map((link) => link.url));
      return summarize(await source.load(validated, progress), 'live', validated);
    },
    demo() {
      const result = summarize(demo(), 'demo');
      return {
        ...result,
        viewSettings: {
          groupBy: result.polls[1]?.id ?? result.polls[0].id,
          filterBy: { pollId: result.polls[0].id },
          minimumParticipants: DEFAULT_PARTICIPANT_MINIMUM,
        } satisfies ViewSettings,
      };
    },
  };
}

export type PollResults = ReturnType<typeof createPollResults>;
