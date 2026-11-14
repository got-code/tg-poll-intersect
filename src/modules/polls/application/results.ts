import { groupByDate } from '../domain/polls.ts';
import { linkIdentity, readPollLinks } from './links.ts';
import type { DateGroup, ParticipantNames, PollData } from '../domain/models.ts';
import type { PollLink } from './links.ts';
import type { PollProgress, PollSource } from './source.ts';

export interface PollResult {
  groups: DateGroup[];
  names: ParticipantNames;
  kind: 'live' | 'demo';
  sourceLinks: string[];
  updatedAt: Date;
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
    return {
      groups: groupByDate(data.polls),
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
      return summarize(demo(), 'demo');
    },
  };
}

export type PollResults = ReturnType<typeof createPollResults>;
