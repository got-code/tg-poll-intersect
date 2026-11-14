import { UserFacingError } from './errors.ts';
import type { PollLink } from './models.ts';
const MAX_MESSAGE_ID = 2147483647;

export function parseLink(value: string): PollLink {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new UserFacingError('Use a message link such as https://t.me/group/123.');
  }
  if (
    url.protocol !== 'https:' ||
    !['t.me', 'telegram.me'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new UserFacingError('Use an https://t.me/… link to a poll message.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const privateLink = parts[0] === 'c';
  let peer: string | number;
  if (privateLink && [3, 4].includes(parts.length) && /^\d+$/.test(parts[1])) {
    const channelId = Number(parts[1]);
    if (!Number.isSafeInteger(channelId) || channelId < 1)
      throw new UserFacingError('Invalid group ID.');
    peer = -1000000000000 - channelId;
  } else if (
    !privateLink &&
    [2, 3].includes(parts.length) &&
    /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(parts[0])
  ) {
    peer = parts[0].toLowerCase();
  } else {
    throw new UserFacingError('Use a message link, not a group invitation.');
  }
  const message = parts.at(-1) ?? '';
  if (
    !/^\d+$/.test(message) ||
    Number(message) < 1 ||
    Number(message) > MAX_MESSAGE_ID ||
    (typeof peer === 'number' && !Number.isSafeInteger(peer))
  ) {
    throw new UserFacingError('Invalid message ID.');
  }
  if (parts.length > (privateLink ? 3 : 2) && !/^\d+$/.test(parts.at(-2) ?? ''))
    throw new UserFacingError('Invalid forum topic link.');
  return { peer, messageId: Number(message), url: url.href };
}

export function nextMessageLink(value: string) {
  const link = parseLink(value);
  if (link.messageId === MAX_MESSAGE_ID)
    throw new UserFacingError('The next message ID exceeds Telegram’s limit.');
  const url = new URL(link.url);
  url.pathname = url.pathname.replace(/\d+\/?$/, String(link.messageId + 1));
  return url.href;
}

// A manual value starts a new sequence. Invalid predecessors stop inference.
export function resolveLinkValues(values: readonly string[]) {
  return values.reduce<string[]>((resolved, value, index) => {
    let next = value.trim();
    if (!next && index > 0 && resolved[index - 1]) {
      try {
        next = nextMessageLink(resolved[index - 1]);
      } catch {
        /* Validate on submit. */
      }
    }
    resolved.push(next);
    return resolved;
  }, []);
}

export function linkIdentity(link: PollLink) {
  return `${link.peer}/${link.messageId}`;
}
