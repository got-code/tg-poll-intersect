import { DomainError } from '../../../domain/errors.ts';
import type { Poll, PollGroup } from './models.ts';

export function isParticipantMinimum(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validatePolls(polls: readonly Poll[]) {
  if (!polls.length || polls.some((poll) => !poll.options.length))
    throw new DomainError('At least one poll with answer options is required.');
  if (polls.some((poll) => !poll.id) || new Set(polls.map((poll) => poll.id)).size !== polls.length)
    throw new DomainError('Each poll must have a distinct identity.');
}

export function groupPolls(polls: readonly Poll[], groupBy: string): PollGroup[] {
  validatePolls(polls);
  const grouping = polls.find((poll) => poll.id === groupBy);
  if (!grouping) throw new DomainError('Choose a loaded poll to group by.');
  const allVoters = [
    ...new Set(polls.flatMap((poll) => poll.options.flatMap((option) => option.voters))),
  ];
  const votersByPoll = new Map(
    polls.map((poll) => [poll.id, new Set(poll.options.flatMap((option) => option.voters))]),
  );
  const votesByPerson = Object.fromEntries(
    allVoters.map((id) => [
      id,
      polls.map((poll) => ({
        pollId: poll.id,
        voted: votersByPoll.get(poll.id)!.has(id),
        at: votersByPoll.get(poll.id)!.has(id) ? (poll.votedAt?.[id] ?? null) : null,
      })),
    ]),
  );
  const implicitGroupIds = allVoters.filter((id) => !votersByPoll.get(groupBy)!.has(id));
  const sections = polls
    .filter((poll) => poll.id !== groupBy)
    .map((poll) => ({
      pollId: poll.id,
      voters: votersByPoll.get(poll.id)!,
      options: poll.options.map((option) => ({
        text: option.text,
        voters: new Set(option.voters),
      })),
    }));
  return grouping.options.map((option) => {
    const explicitIds = [...new Set(option.voters)];
    const explicitGroupVoters = new Set(explicitIds);
    const ids = [...explicitIds, ...implicitGroupIds];
    return {
      pollId: groupBy,
      option: option.text,
      ids,
      explicitIds,
      implicitIds: [...implicitGroupIds],
      votesByPerson,
      sections: sections.map((section) => ({
        pollId: section.pollId,
        options: section.options.map((option) => {
          // Both answers must be chosen for an intersection to be explicit.
          const explicitIds = ids.filter(
            (id) => explicitGroupVoters.has(id) && option.voters.has(id),
          );
          const implicitIds = ids.filter(
            (id) =>
              (option.voters.has(id) || !section.voters.has(id)) &&
              (!explicitGroupVoters.has(id) || !option.voters.has(id)),
          );
          return {
            text: option.text,
            explicitIds,
            implicitIds,
            ids: [...explicitIds, ...implicitIds],
          };
        }),
      })),
    };
  });
}

export function filterGroups(
  groups: readonly PollGroup[],
  pollId: string | null,
  minimum: number,
): PollGroup[] {
  if (!isParticipantMinimum(minimum))
    throw new DomainError('Participant minimum must be a non-negative safe integer.');
  if (pollId === null) return [...groups];
  return groups.flatMap((group) => {
    if (group.pollId === pollId) return group.ids.length >= minimum ? [group] : [];
    const target = group.sections.find((section) => section.pollId === pollId);
    if (!target) throw new DomainError('Choose a loaded poll to filter by.');
    const options = target.options.filter((option) => option.ids.length >= minimum);
    return options.length
      ? [
          {
            ...group,
            sections: group.sections.map((section) =>
              section === target ? { ...section, options } : section,
            ),
          },
        ]
      : [];
  });
}
