import { groupByDate, filterTopics } from '../domain/polls.ts';
import { linkIdentity } from '../domain/links.ts';
import { csv } from '../domain/csv.ts';
import { demo } from '../demo.ts';
import { createAuthController } from './auth.ts';
import { createPollForm } from './poll-form.ts';
import { createResultsRenderer } from './results.ts';
import { $, element, status } from './dom.ts';
import { errorDetails } from '../domain/errors.ts';
import type { AuthSession } from '../application/auth-contracts.ts';
import type {
  DateGroup,
  ParticipantNames,
  PollData,
  PollLink,
  PreferencesStore,
} from '../domain/models.ts';

interface AppDependencies {
  authSession: AuthSession;
  loadPolls(this: void, links: PollLink[], progress: (text: string) => void): Promise<PollData>;
  preferences: PreferencesStore;
  explainError(this: void, error: unknown): string;
}

interface Result {
  groups: DateGroup[];
  names: ParticipantNames;
  kind: 'live' | 'demo';
  sourceLinks: string[];
  updatedAt: string;
}

export function startApp({ authSession, loadPolls, preferences, explainError }: AppDependencies) {
  const renderDates = createResultsRenderer($('rows'));
  const auth = createAuthController({ session: authSession, explainError });
  const form = createPollForm({
    preferences,
    onLinksChange: updateResultMeta,
    onMinimumChange: render,
  });
  let busy = false;
  let result: Result | null = null;

  const visibleGroups = () => (result ? filterTopics(result.groups, form.getMinimum()) : []);
  const linksMatch = () => {
    const current = form.identities();
    return result?.sourceLinks.every((link, index) => link === current[index]);
  };
  const exportDisabled = () =>
    busy || !result || (result.kind === 'live' && !linksMatch()) || !visibleGroups().length;

  function updateResultMeta() {
    if (result) {
      $('resultMeta').textContent =
        result.kind === 'demo'
          ? `${result.groups.length} dates · sample data`
          : !linksMatch()
            ? 'Links changed. Refresh the results.'
            : `${result.groups.length} dates · loaded at ${result.updatedAt}`;
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

  function showData(data: PollData, kind: Result['kind'], links: PollLink[] = []) {
    result = {
      groups: groupByDate(data.polls),
      names: data.names,
      kind,
      sourceLinks: links.map(linkIdentity),
      updatedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    };
    updateResultMeta();
    render();
  }

  function setBusy(value: boolean) {
    busy = value;
    (['refresh', 'demo', 'connect', 'disconnect'] as const).forEach((id) => {
      $(id).disabled = value;
    });
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
      status(errorDetails(error).message, true);
      return;
    }
    if (!auth.isConnected()) {
      auth.openLogin(refresh);
      return;
    }
    setBusy(true);
    if (result?.kind === 'live')
      $('resultMeta').textContent = `Refreshing… Previous results: ${result.updatedAt}`;
    try {
      showData(await loadPolls(links, (text) => status(text)), 'live', links);
      form.collapse();
      status('Done. All four polls have been loaded.');
    } catch (error) {
      status(explainError(error), true);
      if (result?.kind === 'live')
        $('resultMeta').textContent = `Refresh failed · previous results from ${result.updatedAt}`;
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
    showData(demo(), 'demo');
    status(
      'The demo does not connect to Telegram. Add your poll links and refresh to load your results.',
    );
  });
  $('export').addEventListener('click', () => {
    const current = result;
    if (!current || exportDisabled()) return;
    const url = URL.createObjectURL(
      new Blob([csv(visibleGroups(), current.names)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = element('a');
    link.href = url;
    link.download = current.kind === 'demo' ? 'poll-demo.csv' : 'poll-results.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Handles its own errors.
  $('disconnect').addEventListener('click', async () => {
    if (busy || !auth.isConnected()) return;
    setBusy(true);
    try {
      const outcome = await auth.signOut();
      result = null;
      renderDates([], {});
      $('resultMeta').textContent = 'Participants and options for each date';
      $('empty').replaceChildren(
        element('strong', '', 'Disconnected'),
        element(
          'p',
          '',
          auth.hasSavedLogin()
            ? 'Unlock your saved login to load results again.'
            : 'Sign in to Telegram to load results again.',
        ),
      );
      $('empty').hidden = false;
      $('demoLabel').hidden = true;
      $('resultFooter').hidden = true;
      status(outcome.message, outcome.error);
    } catch (error) {
      status(explainError(error), true);
    } finally {
      setBusy(false);
    }
  });
}
