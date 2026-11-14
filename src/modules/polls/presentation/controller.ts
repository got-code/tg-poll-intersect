import { filterTopics } from '../domain/polls.ts';
import { canExportResults, exportResults } from '../application/export.ts';
import { matchesSourceLinks } from '../application/results.ts';
import { csv } from './csv.ts';
import { createPollForm } from './form.ts';
import { createResultsRenderer } from './results.ts';
import { element } from '../../../presentation/dom.ts';
import { $ } from './dom.ts';
import type { PollResult, PollResults } from '../application/results.ts';
import type { PreferencesStore } from '../application/preferences.ts';

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
  const renderDates = createResultsRenderer($('rows'));
  const form = createPollForm({
    preferences,
    onLinksChange: updateResultMeta,
    onMinimumChange: render,
  });
  let busy = false;
  let result: PollResult | null = null;

  const visibleGroups = () => (result ? filterTopics(result.groups, form.getMinimum()) : []);
  const linksMatch = () => result && matchesSourceLinks(result, form.identities());
  const exportDisabled = () =>
    busy || !result || !canExportResults(result, form.identities(), form.getMinimum());
  const loadedTime = (value: PollResult) =>
    value.updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  function updateResultMeta() {
    if (result) {
      $('resultMeta').textContent =
        result.kind === 'demo'
          ? `${result.groups.length} dates · sample data`
          : !linksMatch()
            ? 'Links changed. Refresh the results.'
            : `${result.groups.length} dates · loaded at ${loadedTime(result)}`;
    }
    $('export').disabled = exportDisabled();
  }

  function render() {
    if (!result) return;
    const visible = visibleGroups();
    renderDates(visible, result.names);
    $('empty').hidden = visible.length > 0;
    if (!visible.length) {
      $('empty').replaceChildren(
        element('strong', '', `No dates with topics for at least ${form.getMinimum()} people`),
        element('p', '', 'Lower the topic minimum to see more dates.'),
      );
    }
    $('resultFooter').hidden = false;
    $('demoLabel').hidden = result.kind !== 'demo';
    $('export').disabled = exportDisabled();
  }

  function showData(value: PollResult) {
    result = value;
    updateResultMeta();
    render();
  }

  function setBusy(value: boolean) {
    busy = value;
    (['refresh', 'demo'] as const).forEach((id) => {
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
      );
      form.collapse();
      status('Done. All four polls have been loaded.');
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
  $('demo').addEventListener('click', () => {
    showData(results.demo());
    status(
      'The demo does not connect to Telegram. Add your poll links and refresh to load your results.',
    );
  });
  $('export').addEventListener('click', () => {
    const current = result;
    if (!current || exportDisabled()) return;
    const url = URL.createObjectURL(
      new Blob([csv(exportResults(current, form.identities(), form.getMinimum()))], {
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
      renderDates([], {});
      $('resultMeta').textContent = 'Participants and options for each date';
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
