import { element } from '../../../presentation/dom.ts';
import { createTooltip } from './tooltip.ts';
import { pollLabels } from './labels.ts';
import type { PollGroup, ParticipantNames, PersonVote, Poll } from '../domain/models.ts';

function participantExplanation(
  id: string,
  votes: readonly PersonVote[],
  formatTime: Intl.DateTimeFormat,
  labels: ReadonlyMap<string, string>,
) {
  const time = (at: number | null) => {
    const date = typeof at === 'number' && at > 0 ? new Date(at * 1000) : null;
    return date && Number.isFinite(date.getTime()) ? formatTime.format(date) : 'time unavailable';
  };
  return [
    ...[...votes.filter((vote) => !vote.voted), ...votes.filter((vote) => vote.voted)].map(
      (vote) => `“${labels.get(vote.pollId)}” — ${vote.voted ? time(vote.at) : 'no vote'}`,
    ),
    `Telegram ID: ${id.split(':').at(-1)}`,
  ].join('\n');
}

export function createResultsRenderer(container: HTMLElement) {
  const tooltip = createTooltip();
  const formatTime = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  function countNode(
    explicit: number,
    implicit: number,
    className: string,
    prefix: string,
    context: readonly string[],
  ) {
    const label = prefix + explicit + (implicit ? `(+${implicit}?)` : '');
    if (!implicit) return element('span', className, label);
    const count = element('button', className, label);
    count.type = 'button';
    const explanation = [
      `${implicit} ${implicit === 1 ? 'person has' : 'people have'} no vote in ${context.map((label) => `“${label}”`).join(' or ')}.`,
      `Total: ${explicit + implicit}`,
    ].join('\n');
    count.setAttribute('aria-label', prefix + explanation);
    tooltip.bind(count, explanation);
    return count;
  }

  function people(
    ids: readonly string[],
    names: ParticipantNames,
    implicitIds: readonly string[],
    votesByPerson: Record<string, PersonVote[]>,
    labels: ReadonlyMap<string, string>,
  ) {
    if (!ids.length) return element('span', 'no-people', 'No participants');
    const implicit = new Set(implicitIds);
    const list = element('ul', 'people-list');
    for (const id of ids) {
      const item = element('li');
      const name = names[id] || 'Unnamed participant';
      const button = element('button', implicit.has(id) ? 'person implicit' : 'person', name);
      button.type = 'button';
      const explanation = participantExplanation(id, votesByPerson[id], formatTime, labels);
      tooltip.bind(button, explanation);
      item.append(button);
      list.append(item);
    }
    return list;
  }

  return function render(
    groups: readonly PollGroup[],
    names: ParticipantNames,
    polls: readonly Poll[],
  ) {
    tooltip.hide();
    const titles = pollLabels(polls);
    const labels = new Map(polls.map((poll, index) => [poll.id, titles[index]]));
    container.replaceChildren();
    for (const group of groups) {
      const card = element('section', 'group-card');
      const heading = element('div', 'group-heading');
      const stats = element('div', 'group-stats');
      stats.append(
        countNode(
          group.explicitIds.length,
          group.implicitIds.length,
          'group-count',
          'Participants: ',
          [labels.get(group.pollId)!],
        ),
      );
      heading.append(element('h3', '', group.option), stats);
      const attendees = element('div', 'group-attendees');
      attendees.append(people(group.ids, names, group.implicitIds, group.votesByPerson, labels));
      card.append(heading, attendees);
      for (const section of group.sections) {
        const block = element('section', 'group-section');
        block.append(element('h4', '', labels.get(section.pollId)));
        for (const option of section.options) {
          const context = [labels.get(group.pollId)!, labels.get(section.pollId)!];
          const row = element('div', 'group-option');
          row.append(
            element('span', 'option-name', option.text),
            countNode(
              option.explicitIds.length,
              option.implicitIds.length,
              'option-count',
              '',
              context,
            ),
            people(option.ids, names, option.implicitIds, group.votesByPerson, labels),
          );
          block.append(row);
        }
        card.append(block);
      }
      container.append(card);
    }
  };
}
