import { element } from './dom.mjs';
import { createTooltip } from './tooltip.mjs';

function participantExplanation(id, votes, formatTime) {
  const time = at => {
    const date = typeof at === 'number' && at > 0 ? new Date(at * 1000) : null;
    return date && Number.isFinite(date.getTime()) ? formatTime.format(date) : 'time unavailable';
  };
  return [
    ...[...votes.filter(vote => !vote.voted), ...votes.filter(vote => vote.voted)]
      .map(vote => `${vote.label} — ${vote.voted ? time(vote.at) : 'no vote'}`),
    `Telegram ID: ${String(id).split(':').at(-1)}`,
  ].join('\n');
}

export function createResultsRenderer(container) {
  const tooltip = createTooltip();
  const formatTime = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });

  function countNode(explicit, implicit, className, prefix = '', context = ['Date'], description = '') {
    const count = element(implicit || description ? 'button' : 'span', className, prefix + explicit + (implicit ? `(+${implicit}?)` : ''));
    if (implicit || description) {
      count.type = 'button';
      const explanation = [description,
        implicit ? `${implicit} ${implicit === 1 ? 'person has' : 'people have'} no vote in ${context.join(' or ')}.` : '',
        `Total: ${explicit + implicit}`,
      ].filter(Boolean).join('\n');
      count.setAttribute('aria-label', prefix + explanation);
      tooltip.bind(count, explanation);
    }
    return count;
  }

  function people(ids, names, implicitIds, votesByPerson) {
    if (!ids.length) return element('span', 'no-people', 'No participants');
    const implicit = new Set(implicitIds);
    const list = element('ul', 'people-list');
    for (const id of ids) {
      const item = element('li');
      const name = names[id] || 'Unnamed participant';
      const button = element('button', implicit.has(id) ? 'person implicit' : 'person', name);
      button.type = 'button';
      const explanation = participantExplanation(id, votesByPerson[id], formatTime);
      tooltip.bind(button, explanation);
      item.append(button);
      list.append(item);
    }
    return list;
  }

  return function render(groups, names) {
    tooltip.hide();
    container.replaceChildren();
    for (const group of groups) {
      const card = element('section', 'date-card');
      const heading = element('div', 'date-heading');
      const stats = element('div', 'date-stats');
      stats.append(
        countNode(group.explicitIds.length, group.implicitIds.length, 'date-count', 'Day: '),
        countNode(group.bestTopicExplicitCount, group.bestTopicImplicitCount, 'best-topic-count', 'Top topic: ', ['Date', 'Topic'], 'Largest topic group for this date.'),
      );
      heading.append(element('h3', '', group.date), stats);
      const attendees = element('div', 'date-attendees');
      attendees.append(people(group.ids, names, group.implicitIds, group.votesByPerson));
      card.append(heading, attendees);
      for (const section of group.sections) {
        const block = element('section', 'date-section');
        block.append(element('h4', '', section.label));
        for (const option of section.options) {
          const context = ['Date', section.pollLabel];
          const row = element('div', 'date-option');
          row.append(element('span', 'option-name', option.text),
            countNode(option.explicitIds.length, option.implicitIds.length, 'option-count', '', context),
            people(option.ids, names, option.implicitIds, group.votesByPerson));
          block.append(row);
        }
        card.append(block);
      }
      container.append(card);
    }
  };
}
