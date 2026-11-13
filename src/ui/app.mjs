import { groupByDate, filterTopics } from '../domain/polls.mjs';
import { linkIdentity } from '../domain/links.mjs';
import { csv } from '../domain/csv.mjs';
import { demo } from '../demo.mjs';
import { fetchPolls, explainError } from '../infrastructure/telegram.mjs';
import { hasSavedSession } from '../infrastructure/session.mjs';
import { createAuthController } from './auth.mjs';
import { createPollForm } from './poll-form.mjs';
import { createResultsRenderer } from './results.mjs';
import { bindDiagnostics } from './diagnostics.mjs';
import { $, element, status } from './dom.mjs';

export function startApp() {
  const renderDates = createResultsRenderer($('rows'));
  const auth = createAuthController();
  const form = createPollForm({ onLinksChange: updateResultMeta, onMinimumChange: render });
  let busy = false, result = null;

  const visibleGroups = () => result ? filterTopics(result.groups, form.getMinimum()) : [];
  const linksMatch = () => {
    const current = form.identities();
    return result?.sourceLinks.every((link, index) => link === current[index]);
  };
  const exportDisabled = () => busy || !result || result.kind === 'live' && !linksMatch() || !visibleGroups().length;

  function updateResultMeta() {
    if (result) {
      $('resultMeta').textContent = result.kind === 'demo' ? `${result.groups.length} dates · sample data`
        : !linksMatch() ? 'Links changed. Refresh the results.'
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
      $('empty').replaceChildren(element('strong', '', `No dates with topics for at least ${form.getMinimum()} people`),
        element('p', '', 'Lower the topic minimum to see more dates.'));
    }
    $('resultFooter').hidden = false;
    $('demoLabel').hidden = result.kind !== 'demo';
    $('export').disabled = exportDisabled();
  }

  function showData(data, kind, links = []) {
    result = {
      groups: groupByDate(data.polls), names: data.names, kind,
      sourceLinks: links.map(linkIdentity),
      updatedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    };
    updateResultMeta();
    render();
  }

  function setBusy(value) {
    busy = value;
    ['refresh', 'demo', 'connect', 'disconnect'].forEach(id => { $(id).disabled = value; });
    form.setDisabled(value);
    $('refresh').textContent = value ? 'Loading…' : 'Refresh results ↗';
    $('export').disabled = exportDisabled();
  }

  async function refresh() {
    if (busy) return;
    let links;
    try { links = form.readLinks(); } catch (error) { status(error.message, true); return; }
    const client = auth.getClient();
    if (!client) { auth.openLogin(refresh); return; }
    setBusy(true);
    if (result?.kind === 'live') $('resultMeta').textContent = `Refreshing… Previous results: ${result.updatedAt}`;
    try {
      showData(await fetchPolls(client, links, text => status(text)), 'live', links);
      status('Done. All four polls have been loaded.');
    } catch (error) {
      status(explainError(error), true);
      if (result?.kind === 'live') $('resultMeta').textContent = `Refresh failed · previous results from ${result.updatedAt}`;
    } finally { setBusy(false); }
  }

  $('pollForm').addEventListener('submit', event => { event.preventDefault(); return refresh(); });
  $('demo').addEventListener('click', () => {
    showData(demo(), 'demo');
    status('The demo does not connect to Telegram. Add your poll links and refresh to load your results.');
  });
  $('export').addEventListener('click', () => {
    if (exportDisabled()) return;
    const url = URL.createObjectURL(new Blob([csv(visibleGroups(), result.names)], { type: 'text/csv;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = result.kind === 'demo' ? 'poll-demo.csv' : 'poll-results.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  $('disconnect').addEventListener('click', async () => {
    if (busy || !auth.getClient()) return;
    setBusy(true);
    try {
      const outcome = await auth.signOut();
      result = null;
      renderDates([], {});
      $('resultMeta').textContent = 'Participants and options for each date';
      $('empty').replaceChildren(element('strong', '', 'Disconnected'), element('p', '', hasSavedSession()
        ? 'Unlock your saved login to load results again.' : 'Sign in to Telegram to load results again.'));
      $('empty').hidden = false;
      $('demoLabel').hidden = true;
      $('resultFooter').hidden = true;
      status(outcome.message, outcome.error);
    } finally { setBusy(false); }
  });
  bindDiagnostics();
}
