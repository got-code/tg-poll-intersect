import { POLL_LABELS } from '../domain/links.mjs';
import { element } from './dom.mjs';
import { createTooltip } from './tooltip.mjs';

function participantExplanation(id, explicitPolls, context) {
  const missing = POLL_LABELS.filter(label => !explicitPolls.includes(label));
  const assumed = context.filter(label => missing.includes(label));
  const other = missing.filter(label => !context.includes(label));
  return [
    `Implicit here: ${assumed.join(', ')} — no vote; all options assumed.`,
    other.length ? `Other implicit polls: ${other.join(', ')} — no vote.` : '',
    `Explicit votes: ${explicitPolls.join(', ') || 'none'}.`,
    `Telegram ID: ${String(id).split(':').at(-1)}`,
  ].filter(Boolean).join('\n');
}

export function createResultsRenderer(container) {
  const tooltip = createTooltip();

  function countNode(explicit, implicit, className, prefix = '', context = ['Date']) {
    const count = element(implicit ? 'button' : 'span', className, prefix + explicit + (implicit ? `(+${implicit}?)` : ''));
    if (implicit) {
      count.type = 'button';
      const explanation = `Explicit: ${explicit}. Implicit: ${implicit} — no vote in ${context.join(' or ')}. An unanswered poll assumes all its options. Total: ${explicit + implicit}.`;
      count.setAttribute('aria-label', prefix + explanation);
      tooltip.bind(count, explanation);
    }
    return count;
  }

  function people(ids, names, implicitIds, votesByPerson, context) {
    if (!ids.length) return element('span', 'no-people', 'No participants');
    const implicit = new Set(implicitIds);
    const list = element('ul', 'people-list');
    for (const id of ids) {
      const item = element('li');
      const name = names[id] || 'Unnamed participant';
      const button = element('button', implicit.has(id) ? 'person implicit' : 'person', name);
      button.type = 'button';
      const explanation = implicit.has(id)
        ? participantExplanation(id, votesByPerson[id], context)
        : 'Telegram ID: ' + String(id).split(':').at(-1);
      if (implicit.has(id)) button.setAttribute('aria-label', `${name}. ${explanation}`);
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
        countNode(group.bestTopicExplicitCount, group.bestTopicImplicitCount, 'best-topic-count', 'Top topic: ', ['Date', 'Topic']),
      );
      heading.append(element('h3', '', group.date), stats);
      const attendees = element('div', 'date-attendees');
      attendees.append(people(group.ids, names, group.implicitIds, group.votesByPerson, ['Date']));
      card.append(heading, attendees);
      for (const section of group.sections) {
        const block = element('section', 'date-section');
        block.append(element('h4', '', section.label));
        for (const option of section.options) {
          const context = ['Date', section.pollLabel];
          const row = element('div', 'date-option');
          row.append(element('span', 'option-name', option.text),
            countNode(option.explicitIds.length, option.implicitIds.length, 'option-count', '', context),
            people(option.ids, names, option.implicitIds, group.votesByPerson, context));
          block.append(row);
        }
        card.append(block);
      }
      container.append(card);
    }
  };
}
