import { UserFacingError } from './errors.ts';
import { POLL_LABELS } from './models.ts';
import type { DateGroup, Poll, PollSection } from './models.ts';

export const DEFAULT_TOPIC_MINIMUM = 3;

export function topicMinimum(value: unknown) {
  const number = Number(value);
  return (typeof value === 'string' && value.trim() === '') ||
    !Number.isSafeInteger(number) ||
    number < 0
    ? DEFAULT_TOPIC_MINIMUM
    : number;
}

export function groupByDate(polls: readonly Poll[]): DateGroup[] {
  if (polls.length !== 4 || polls.some((p) => !p.options.length))
    throw new UserFacingError('Four polls with answer options are required.');
  const allVoters = [
    ...new Set(
      polls.flatMap((poll) => poll.options.flatMap((option) => option.voters.map(String))),
    ),
  ];
  const votersByPoll = polls.map(
    (poll) => new Set(poll.options.flatMap((option) => option.voters.map(String))),
  );
  const votesByPerson = Object.fromEntries(
    allVoters.map((id) => [
      id,
      polls.map((poll, index) => ({
        label: POLL_LABELS[index],
        voted: votersByPoll[index].has(id),
        at: votersByPoll[index].has(id) ? (poll.votedAt?.[id] ?? null) : null,
      })),
    ]),
  );
  const dateVoters = votersByPoll[1];
  const implicitDateIds = allVoters.filter((id) => !dateVoters.has(id));
  const sections = [
    { label: 'Topics', index: 0 },
    { label: 'Time', index: 2 },
    { label: 'Places', index: 3 },
  ].map((section) => ({
    ...section,
    voters: votersByPoll[section.index],
    options: polls[section.index].options.map((option) => ({
      text: option.text,
      voters: new Set(option.voters.map(String)),
    })),
  }));
  // Dates, times and places keep poll order; topic popularity is local to each date.
  return polls[1].options.map((date) => {
    const explicitIds = [...new Set(date.voters.map(String))];
    const explicitDateVoters = new Set(explicitIds);
    const ids = [...explicitIds, ...implicitDateIds];
    const groupedSections: PollSection[] = sections.map((section) => ({
      label: section.label,
      pollLabel: POLL_LABELS[section.index],
      options: section.options.map((option) => {
        // An intersection is explicit only when both the date and option were chosen.
        const explicitIds = ids.filter((id) => explicitDateVoters.has(id) && option.voters.has(id));
        const implicitIds = ids.filter(
          (id) =>
            (option.voters.has(id) || !section.voters.has(id)) &&
            (!explicitDateVoters.has(id) || !option.voters.has(id)),
        );
        return {
          text: option.text,
          explicitIds,
          implicitIds,
          ids: [...explicitIds, ...implicitIds],
        };
      }),
    }));
    groupedSections[0].options.sort(
      (a, b) => b.ids.length - a.ids.length || b.explicitIds.length - a.explicitIds.length,
    );
    const bestTopic = groupedSections[0].options[0];
    return {
      date: date.text,
      ids,
      explicitIds,
      implicitIds: [...implicitDateIds],
      votesByPerson,
      bestTopicCount: bestTopic?.ids.length ?? 0,
      bestTopicExplicitCount: bestTopic?.explicitIds.length ?? 0,
      bestTopicImplicitCount: bestTopic?.implicitIds.length ?? 0,
      sections: groupedSections,
    };
  });
}

export function filterTopics(
  groups: readonly DateGroup[],
  minimum = DEFAULT_TOPIC_MINIMUM,
): DateGroup[] {
  return groups
    .map((group) => ({
      ...group,
      sections: group.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              options: section.options.filter((option) => option.ids.length >= minimum),
            }
          : section,
      ),
    }))
    .filter((group) => group.sections[0].options.length > 0);
}
