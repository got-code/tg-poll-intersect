import { UserFacingError } from '../domain/errors.mjs';
import { POLL_LABELS, parseLink, resolveLinkValues, linkIdentity } from '../domain/links.mjs';
import { readPreferences, writePreferences, topicMinimum } from '../infrastructure/preferences.mjs';
import { $ } from './dom.mjs';

export function createPollForm({ onLinksChange, onMinimumChange }) {
  const fields = POLL_LABELS.map((_, index) => $(`link${index}`));
  const minimum = $('topicMinimum');
  const clear = $('clearLinks');
  const preferences = readPreferences();
  fields.forEach((field, index) => { field.value = preferences.links[index]; });
  minimum.value = String(preferences.topicMinimum);

  const values = () => fields.map(field => field.value);
  const resolved = () => resolveLinkValues(values());
  const getMinimum = () => topicMinimum(minimum.value);

  function updateSuggestions() {
    const links = resolved();
    fields.forEach((field, index) => {
      field.placeholder = links[index] || (index === 0 ? 'https://t.me/group/123' : 'Next message, or paste a link');
      field.setAttribute('aria-describedby', `linkHint${index}`);
      $(`linkHint${index}`).textContent = index === 0 ? 'Start with the topic poll.'
        : !field.value.trim() && links[index] ? 'Automatic · next message after the previous poll.' : 'Leave blank to use the next message.';
    });
    clear.hidden = fields.filter(field => field.value.trim()).length < 2;
  }

  function persist() {
    const saved = writePreferences({ links: values(), topicMinimum: getMinimum() });
    $('preferencesHint').textContent = saved ? 'Links and topic minimum are saved in this browser.' : 'Browser storage is unavailable. These settings will not survive a reload.';
  }

  fields.forEach(field => field.addEventListener('input', () => {
    updateSuggestions();
    persist();
    onLinksChange();
  }));
  clear.addEventListener('click', () => {
    fields.forEach(field => { field.value = ''; });
    updateSuggestions();
    persist();
    onLinksChange();
    fields[0].focus();
  });
  minimum.addEventListener('input', () => { persist(); onMinimumChange(); });
  minimum.addEventListener('change', () => {
    minimum.value = String(getMinimum());
    persist();
    // Input already updated the results. Replacing them again on blur would
    // remove the participant button receiving keyboard or pointer focus.
  });
  updateSuggestions();

  return {
    getMinimum,
    identities: () => resolved().map(value => { try { return linkIdentity(parseLink(value)); } catch { return ''; } }),
    readLinks() {
      const links = resolved().map((value, index) => {
        try { return parseLink(value); }
        catch (error) {
          fields[index].focus();
          throw new UserFacingError(`${POLL_LABELS[index]}: ${error.message}`);
        }
      });
      if (new Set(links.map(linkIdentity)).size !== 4) throw new UserFacingError('Choose four different poll messages.');
      return links;
    },
    setDisabled(disabled) {
      [...fields, clear].forEach(control => { control.disabled = disabled; });
    },
  };
}
