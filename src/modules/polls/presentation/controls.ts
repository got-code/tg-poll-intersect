import { resolveParticipantMinimum } from '../application/preferences.ts';
import { resolveViewSettings } from '../application/results.ts';
import type { ViewSettings } from '../application/preferences.ts';
import type { Poll } from '../domain/models.ts';
import { element } from '../../../presentation/dom.ts';
import { pollLabels } from './labels.ts';
import { $ } from './dom.ts';

export function createViewControls(initial: ViewSettings, onChange: () => void) {
  const grouping = $('groupBy');
  const filter = $('filterBy');
  const minimum = $('minimumParticipants');
  let settings = initial;
  let polls: readonly Poll[] = [];
  minimum.value = String(initial.minimumParticipants);
  const getSettings = (): ViewSettings => ({
    groupBy: settings.groupBy,
    filterBy: settings.filterBy,
    minimumParticipants: resolveParticipantMinimum(
      minimum.value.trim() ? Number(minimum.value) : undefined,
    ),
  });
  function updateControls() {
    grouping.disabled = filter.disabled = !polls.length;
    minimum.disabled = !polls.length || settings.filterBy === 'none';
  }
  const option = (value: string, text: string) => {
    const node = element('option', '', text);
    node.value = value;
    return node;
  };
  grouping.addEventListener('change', () => {
    settings = { ...getSettings(), groupBy: grouping.value };
    updateControls();
    onChange();
  });
  filter.addEventListener('change', () => {
    settings = {
      ...getSettings(),
      filterBy:
        filter.value === 'grouping' || filter.value === 'none'
          ? filter.value
          : { pollId: filter.value.slice(5) },
    };
    updateControls();
    onChange();
  });
  minimum.addEventListener('input', onChange);
  minimum.addEventListener('change', () => {
    minimum.value = String(getSettings().minimumParticipants);
    // Input already updated results; preserve focus on participant buttons on blur.
  });
  updateControls();
  return {
    getSettings,
    setPolls(value: readonly Poll[], nextSettings: ViewSettings = getSettings()) {
      polls = value;
      settings = polls.length ? resolveViewSettings(polls, nextSettings) : nextSettings;
      minimum.value = String(settings.minimumParticipants);
      const labels = pollLabels(polls);
      grouping.replaceChildren(...polls.map((poll, index) => option(poll.id, labels[index])));
      filter.replaceChildren(
        option('grouping', 'Same as Group by'),
        option('none', 'None'),
        ...polls.map((poll, index) => option(`poll:${poll.id}`, labels[index])),
      );
      grouping.value = settings.groupBy ?? '';
      filter.value =
        typeof settings.filterBy === 'object'
          ? `poll:${settings.filterBy.pollId}`
          : settings.filterBy;
      updateControls();
    },
  };
}
