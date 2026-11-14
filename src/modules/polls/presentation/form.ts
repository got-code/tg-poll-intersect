import {
  parseLink,
  resolveLinkValues,
  linkIdentity,
  readPollLinks,
  PollLinkError,
} from '../application/links.ts';
import { pollLabels } from './labels.ts';
import { UserFacingError } from '../../../application/errors.ts';
import { element } from '../../../presentation/dom.ts';
import type { Poll } from '../domain/models.ts';
import { $ } from './dom.ts';

export function createPollForm({
  links,
  onLinksChange,
}: {
  links: readonly string[];
  onLinksChange: () => void;
}) {
  const details = $('pollLinks');
  const clear = $('clearLinks');
  const add = $('addPoll');
  let rows: {
    input: HTMLInputElement;
    caption: HTMLElement;
    hint: HTMLElement;
    remove: HTMLButtonElement;
  }[] = [];
  let labels = new Map<string, string>();
  let disabled = false;
  const values = () => rows.map((row) => row.input.value);
  const resolved = () => resolveLinkValues(values());
  const identity = (value: string) => {
    try {
      return linkIdentity(parseLink(value));
    } catch {
      return '';
    }
  };

  function readLinks(revealError = true) {
    try {
      return readPollLinks(values());
    } catch (error) {
      if (revealError) {
        details.open = true;
        if (error instanceof PollLinkError) rows[error.index].input.focus();
      }
      if (error instanceof PollLinkError)
        throw new UserFacingError(`${rows[error.index].caption.textContent}: ${error.message}`);
      throw error;
    }
  }

  function updateSuggestions() {
    const links = resolved();
    rows.forEach((row, index) => {
      const label = labels.get(identity(links[index])) || `Poll ${index + 1}`;
      row.caption.textContent = label;
      row.input.setAttribute('aria-label', `${label} link`);
      row.remove.setAttribute('aria-label', `Remove ${label}`);
      row.remove.disabled = disabled;
      row.remove.setAttribute(
        'aria-disabled',
        String(disabled || (rows.length === 1 && !row.input.value.trim())),
      );
      row.input.placeholder =
        links[index] || (index === 0 ? 'https://t.me/group/123' : 'Next message, or paste a link');
      row.hint.textContent =
        index === 0
          ? 'Paste a link to any poll.'
          : !row.input.value.trim() && links[index]
            ? 'Automatic · next message after the previous poll.'
            : 'Leave blank to use the next message.';
    });
    clear.hidden = !rows.some((row) => row.input.value.trim());
    let configured = false;
    try {
      readLinks(false);
      configured = true;
    } catch {
      /* Incomplete input stays editable. */
    }
    $('pollLinksCount').textContent = configured
      ? ` · ${rows.length} ${rows.length === 1 ? 'poll' : 'polls'}`
      : '';
    return configured;
  }

  function changed() {
    updateSuggestions();
    onLinksChange();
  }

  function renderFields(links: readonly string[]) {
    $('pollLinkFields').replaceChildren();
    rows = links.map((value, index) => {
      const row = element('div', 'poll-link');
      const label = element('label');
      const caption = element('span', 'poll-title');
      const input = element('input');
      input.id = `link${index}`;
      input.type = 'url';
      input.value = value;
      input.required = index === 0;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.disabled = disabled;
      const hint = element('span', 'field-hint');
      hint.id = `linkHint${index}`;
      input.setAttribute('aria-describedby', hint.id);
      label.append(
        element('span', 'num', String(index + 1).padStart(2, '0')),
        caption,
        input,
        hint,
      );
      const remove = element('button', 'text remove-poll', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (disabled) return;
        if (rows.length === 1) {
          if (!input.value.trim()) return;
          input.value = '';
          changed();
          remove.focus();
          return;
        }
        const remaining = values().filter((_, position) => position !== index);
        renderFields(remaining);
        changed();
        rows[Math.min(index, rows.length - 1)].remove.focus();
      });
      input.addEventListener('input', changed);
      input.addEventListener('invalid', () => {
        details.open = true;
      });
      row.append(label, remove);
      $('pollLinkFields').append(row);
      return { input, caption, hint, remove };
    });
    updateSuggestions();
  }

  add.addEventListener('click', () => {
    renderFields([...values(), '']);
    changed();
    add.focus({ preventScroll: true });
  });
  clear.addEventListener('click', () => {
    details.open = true;
    rows.forEach((row) => {
      row.input.value = '';
    });
    changed();
    rows[0].input.focus();
  });
  renderFields(links);
  details.open = !updateSuggestions();

  return {
    values,
    identities: () => resolved().map(identity),
    readLinks: () => readLinks(),
    setPolls(polls: readonly Poll[]) {
      const titles = pollLabels(polls);
      labels = new Map(polls.map((poll, index) => [poll.id, titles[index]]));
      updateSuggestions();
    },
    collapse() {
      if (details.contains(document.activeElement)) $('pollLinksToggle').focus();
      details.open = false;
    },
    setDisabled(value: boolean) {
      disabled = value;
      [...rows.flatMap((row) => [row.input, row.remove]), clear, add].forEach((control) => {
        control.disabled = value;
      });
      updateSuggestions();
    },
  };
}
