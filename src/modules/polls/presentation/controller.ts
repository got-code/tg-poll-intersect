import { exportResults } from '../application/export.ts';
import { matchesSourceLinks, selectResultGroups } from '../application/results.ts';
import { csv } from './csv.ts';
import { createViewControls } from './controls.ts';
import { pollLabels } from './labels.ts';
import { createPollForm } from './form.ts';
import { createResultsRenderer } from './results.ts';
import { element } from '../../../presentation/dom.ts';
import { $ } from './dom.ts';
import type { PollGroup } from '../domain/models.ts';
import type { PollResult, PollResults } from '../application/results.ts';
import type { PreferencesStore, ViewSettings } from '../application/preferences.ts';

interface PollDependencies {
  results: PollResults;
  preferences: PreferencesStore;
  explainError(this: void, error: unknown): string;
  notify(this: void, text: string, error?: boolean): void;
  isConnected(this: void): boolean;
  openLogin(this: void, after: () => Promise<void>): void;
  onBusyChange(this: void, busy: boolean): void;
}

export function createPollController({
  results,
  preferences,
  explainError,
  notify: status,
  isConnected,
  openLogin,
  onBusyChange,
}: PollDependencies) {
  const renderGroups = createResultsRenderer($('rows'));
  const saved = preferences.readPreferences();
  const help = $('viewHelp');
  help.open = !saved.links.some((link) => link.trim());
  function updateHelpDescriptions() {
    for (const [id, hint] of [
      ['groupBy', 'groupByHint'],
      ['filterBy', 'filterByHint'],
    ] as const) {
      if (help.open) $(id).setAttribute('aria-describedby', hint);
      else $(id).removeAttribute('aria-describedby');
    }
  }
  help.addEventListener('toggle', updateHelpDescriptions);
  updateHelpDescriptions();
  let busy = false;
  let result: PollResult | null = null;
  let visible: PollGroup[] = [];
  let preferencesAvailable = true;
  const controls = createViewControls(saved, () => {
    if (result?.kind !== 'demo') {
      liveSettings = controls.getSettings();
      persist();
    }
    render();
  });
  let liveSettings = controls.getSettings();
  const form = createPollForm({
    links: saved.links,
    onLinksChange() {
      persist();
      updateResultMeta();
    },
  });

  const linksMatch = () => result && matchesSourceLinks(result, form.identities());
  const exportDisabled = () => busy || !result || !linksMatch() || !visible.length;
  const loadedTime = (value: PollResult) =>
    value.updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  function persist() {
    preferencesAvailable = preferences.writePreferences({ links: form.values(), ...liveSettings });
    updatePreferencesHint();
  }

  function updatePreferencesHint() {
    $('preferencesHint').textContent = preferencesAvailable
      ? result?.kind === 'demo'
        ? 'Demo view settings are temporary. Your own settings are kept.'
        : 'Links and view settings are saved in this browser.'
      : 'Browser storage is unavailable. These settings will not survive a reload.';
  }

  function updateResultMeta() {
    if (result) {
      $('resultMeta').textContent =
        result.kind === 'live' && !linksMatch()
          ? 'Links changed. Refresh the results.'
          : `${visible.length} ${visible.length === 1 ? 'group' : 'groups'} · ${result.polls.length} ${result.polls.length === 1 ? 'poll' : 'polls'}${result.kind === 'live' ? ` · loaded at ${loadedTime(result)}` : ''}`;
    }
    $('export').disabled = exportDisabled();
  }

  function render() {
    if (!result) return;
    const settings = controls.getSettings();
    visible = selectResultGroups(result, settings);
    const labels = pollLabels(result.polls);
    const groupIndex = result.polls.findIndex((poll) => poll.id === settings.groupBy);
    $('resultHeading').textContent = `By “${labels[groupIndex]}”`;
    renderGroups(visible, result.names, result.polls);
    $('empty').hidden = visible.length > 0;
    if (!visible.length) {
      $('empty').replaceChildren(
        element('strong', '', 'No groups match the participant minimum'),
        element('p', '', 'Lower the minimum, choose another poll or turn off the filter.'),
      );
    }
    $('resultFooter').hidden = !visible.length;
    $('demoLabel').hidden = result.kind !== 'demo';
    updateResultMeta();
  }

  function showData(value: PollResult, settings: ViewSettings) {
    result = value;
    controls.setPolls(value.polls, settings);
    if (value.kind === 'live') {
      liveSettings = controls.getSettings();
      form.setPolls(value.polls);
    }
    updatePreferencesHint();
    render();
  }

  function setBusy(value: boolean) {
    busy = value;
    (['refresh', 'demo', 'demoExample'] as const).forEach((id) => {
      $(id).disabled = value;
    });
    onBusyChange(value);
    form.setDisabled(value);
    $('refresh').textContent = value ? 'Loading…' : 'Refresh results ↗';
    $('export').disabled = exportDisabled();
  }

  async function refresh() {
    if (busy) return;
    let links;
    try {
      links = form.readLinks();
    } catch (error) {
      status(explainError(error), true);
      return;
    }
    if (!isConnected()) {
      openLogin(refresh);
      return;
    }
    setBusy(true);
    if (result?.kind === 'live')
      $('resultMeta').textContent = `Refreshing… Previous results: ${loadedTime(result)}`;
    try {
      showData(
        await results.load(links, (event) =>
          status(
            event.kind === 'loading'
              ? `Poll ${event.index} of ${event.total}: loading votes…`
              : 'Checking result completeness…',
          ),
        ),
        liveSettings,
      );
      form.collapse();
      status(
        `Done. ${result!.polls.length} ${result!.polls.length === 1 ? 'poll' : 'polls'} loaded.`,
      );
    } catch (error) {
      status(explainError(error), true);
      if (result?.kind === 'live')
        $('resultMeta').textContent =
          `Refresh failed · previous results from ${loadedTime(result)}`;
    } finally {
      setBusy(false);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Handles its own errors.
  $('pollForm').addEventListener('submit', (event) => {
    event.preventDefault();
    return refresh();
  });
  function showDemo() {
    const demo = results.demo();
    showData(demo, demo.viewSettings);
    status(
      'The demo does not connect to Telegram. Add your poll links and refresh to load your results.',
    );
  }
  $('demo').addEventListener('click', showDemo);
  $('demoExample').addEventListener('click', showDemo);
  $('export').addEventListener('click', () => {
    const current = result;
    if (!current || exportDisabled()) return;
    const url = URL.createObjectURL(
      new Blob([csv(exportResults(current, form.identities(), controls.getSettings()))], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const link = element('a');
    link.href = url;
    link.download = current.kind === 'demo' ? 'poll-demo.csv' : 'poll-results.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  return {
    clear(hasSavedLogin: boolean) {
      result = null;
      visible = [];
      renderGroups([], {}, []);
      controls.setPolls([], liveSettings);
      updatePreferencesHint();
      form.setPolls([]);
      $('resultHeading').textContent = 'Intersections';
      $('resultMeta').textContent = 'Participants and answer overlaps across polls';
      $('empty').replaceChildren(
        element('strong', '', 'Disconnected'),
        element(
          'p',
          '',
          hasSavedLogin
            ? 'Unlock your saved login to load results again.'
            : 'Sign in to Telegram to load results again.',
        ),
      );
      $('empty').hidden = false;
      $('demoLabel').hidden = true;
      $('resultFooter').hidden = true;
      $('export').disabled = true;
    },
  };
}
