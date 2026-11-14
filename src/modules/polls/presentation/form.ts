import {
  parseLink,
  resolveLinkValues,
  linkIdentity,
  readPollLinks,
  PollLinkError,
} from '../application/links.ts';
import { POLL_KINDS } from '../domain/models.ts';
import { POLL_LABELS } from './labels.ts';
import { UserFacingError } from '../../../application/errors.ts';
import type { PreferencesStore } from '../application/preferences.ts';
import { resolveTopicMinimum } from '../application/preferences.ts';
import { $ } from './dom.ts';

export function createPollForm({
  preferences,
  onLinksChange,
  onMinimumChange,
}: {
  preferences: PreferencesStore;
  onLinksChange: () => void;
  onMinimumChange: () => void;
}) {
  const fields = POLL_KINDS.map((_, index) => $(`link${index}`));
  const minimum = $('topicMinimum');
  const clear = $('clearLinks');
  const details = $('pollLinks');
  const saved = preferences.readPreferences();
  fields.forEach((field, index) => {
    field.value = saved.links[index];
  });
  minimum.value = String(saved.topicMinimum);

  const values = () => fields.map((field) => field.value);
  const resolved = () => resolveLinkValues(values());
  const getMinimum = () => {
    const text = minimum.value.trim();
    return resolveTopicMinimum(text ? Number(text) : undefined);
  };

  function readLinks(revealError = true) {
    try {
      return readPollLinks(values());
    } catch (error) {
      if (revealError) {
        details.open = true;
        if (error instanceof PollLinkError) fields[error.index].focus();
      }
      if (error instanceof PollLinkError)
        throw new UserFacingError(`${POLL_LABELS[POLL_KINDS[error.index]]}: ${error.message}`);
      throw error;
    }
  }

  function updateSuggestions() {
    const links = resolved();
    fields.forEach((field, index) => {
      field.placeholder =
        links[index] || (index === 0 ? 'https://t.me/group/123' : 'Next message, or paste a link');
      field.setAttribute('aria-describedby', `linkHint${index}`);
      $(`linkHint${index}`).textContent =
        index === 0
          ? 'Start with the topic poll.'
          : !field.value.trim() && links[index]
            ? 'Automatic · next message after the previous poll.'
            : 'Leave blank to use the next message.';
    });
    clear.hidden = fields.filter((field) => field.value.trim()).length < 2;
    let configured = false;
    try {
      readLinks(false);
      configured = true;
    } catch {
      /* Incomplete input stays editable. */
    }
    $('pollLinksCount').textContent = configured ? ' · 4 polls' : '';
    return configured;
  }

  function persist() {
    const saved = preferences.writePreferences({ links: values(), topicMinimum: getMinimum() });
    $('preferencesHint').textContent = saved
      ? 'Links and topic minimum are saved in this browser.'
      : 'Browser storage is unavailable. These settings will not survive a reload.';
  }

  fields.forEach((field) =>
    field.addEventListener('input', () => {
      updateSuggestions();
      persist();
      onLinksChange();
    }),
  );
  fields.forEach((field) =>
    field.addEventListener('invalid', () => {
      details.open = true;
    }),
  );
  clear.addEventListener('click', () => {
    details.open = true;
    fields.forEach((field) => {
      field.value = '';
    });
    updateSuggestions();
    persist();
    onLinksChange();
    fields[0].focus();
  });
  minimum.addEventListener('input', () => {
    persist();
    onMinimumChange();
  });
  minimum.addEventListener('change', () => {
    minimum.value = String(getMinimum());
    persist();
    // Input already updated the results. Replacing them again on blur would
    // remove the participant button receiving keyboard or pointer focus.
  });
  details.open = !updateSuggestions();

  return {
    getMinimum,
    identities: () =>
      resolved().map((value) => {
        try {
          return linkIdentity(parseLink(value));
        } catch {
          return '';
        }
      }),
    readLinks: () => readLinks(),
    collapse() {
      if (
        fields.some((field) => field === document.activeElement) ||
        document.activeElement === clear
      )
        $('pollLinksToggle').focus();
      details.open = false;
    },
    setDisabled(disabled: boolean) {
      [...fields, clear].forEach((control) => {
        control.disabled = disabled;
      });
    },
  };
}
