import { UserFacingError } from '../../../application/errors.ts';
import { POLL_KINDS } from '../domain/models.ts';

export interface PollLink {
  peer: { kind: 'username'; name: string } | { kind: 'channel'; id: number };
  messageId: number;
  url: string;
}

export class PollLinkError extends UserFacingError {
  readonly index: number;

  constructor(index: number, message: string) {
    super(message);
    this.index = index;
  }
}
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
  let peer: PollLink['peer'];
  if (privateLink && [3, 4].includes(parts.length) && /^\d+$/.test(parts[1])) {
    const channelId = Number(parts[1]);
    if (!Number.isSafeInteger(channelId) || channelId < 1)
      throw new UserFacingError('Invalid group ID.');
    peer = { kind: 'channel', id: channelId };
  } else if (
    !privateLink &&
    [2, 3].includes(parts.length) &&
    /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(parts[0])
  ) {
    peer = { kind: 'username', name: parts[0].toLowerCase() };
  } else {
    throw new UserFacingError('Use a message link, not a group invitation.');
  }
  const message = parts.at(-1) ?? '';
  if (!/^\d+$/.test(message) || Number(message) < 1 || Number(message) > MAX_MESSAGE_ID) {
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
  const peer = link.peer.kind === 'channel' ? link.peer.id : link.peer.name;
  return `${link.peer.kind}:${peer}/${link.messageId}`;
}

export function readPollLinks(values: readonly string[]): PollLink[] {
  if (values.length !== POLL_KINDS.length)
    throw new UserFacingError('Four poll links are required.');
  const seen = new Set<string>();
  return resolveLinkValues(values).map((value, index) => {
    try {
      const link = parseLink(value);
      const identity = linkIdentity(link);
      if (seen.has(identity)) throw new UserFacingError('Choose four different poll messages.');
      seen.add(identity);
      return link;
    } catch (error) {
      if (error instanceof UserFacingError) throw new PollLinkError(index, error.message);
      throw error;
    }
  });
}
