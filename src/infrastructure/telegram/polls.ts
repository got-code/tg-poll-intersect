import { UserFacingError } from '../../domain/errors.ts';
import { MtPeerNotFoundError } from '@mtcute/web';
import { getMessages, resolvePeer, iterDialogs } from '@mtcute/web/methods.js';
import { readVoters } from './voters.ts';
import type { BaseTelegramClient, Poll as TelegramPoll } from '@mtcute/web';
import type { ParticipantNames, Poll, PollData, PollLink } from '../../domain/models.ts';

async function findPeer(client: BaseTelegramClient, id: string | number) {
  try {
    return await resolvePeer(client, id);
  } catch (error) {
    if (typeof id !== 'number' || !(error instanceof MtPeerNotFoundError)) throw error;
    // Private links contain no access_hash. Resolve joined chats via the dialog list.
    for await (const dialog of iterDialogs(client, { archived: 'keep' })) {
      if (dialog.peer.id === id) return dialog.peer.inputPeer;
    }
    throw new UserFacingError(
      'The group was not found in your chats. Check the link and your access.',
    );
  }
}

function fingerprint(poll: TelegramPoll) {
  return JSON.stringify([
    String(poll.id),
    poll.question,
    poll.answers.map((answer) => [
      answer.text,
      Array.from(answer.data),
      answer.result?.voters ?? null,
    ]),
  ]);
}

export async function fetchPolls(
  client: BaseTelegramClient,
  links: readonly PollLink[],
  progress: (text: string) => void,
): Promise<PollData> {
  const polls: Poll[] = [],
    names: ParticipantNames = {};
  const checks: {
    peer: Awaited<ReturnType<typeof findPeer>>;
    messageId: number;
    fingerprint: string;
  }[] = [];
  for (let i = 0; i < links.length; i++) {
    progress(`Poll ${i + 1} of 4: loading votes…`);
    const { peer: id, messageId } = links[i];
    const peer = await findPeer(client, id);
    const [message] = await getMessages(client, peer, messageId);
    const poll = message?.media;
    if (poll?.type !== 'poll')
      throw new UserFacingError(`Link ${i + 1}: the message does not contain a poll.`);
    if (!poll.isPublic)
      throw new UserFacingError(`Poll ${i + 1} is anonymous. Voter intersections are unavailable.`);
    const options: Poll['options'] = [],
      votedAt: Record<string, number> = {};
    for (const answer of poll.answers) {
      const voters = await readVoters(async (offset) => {
        const page = await client.call({
          _: 'messages.getPollVotes',
          peer,
          id: messageId,
          option: answer.data,
          offset,
          limit: 100,
        });
        const users = new Map(page.users.map((user) => [String(user.id), user]));
        const chats = new Map(page.chats.map((chat) => [String(chat.id), chat]));
        const people = page.votes.map((vote) => {
          const p = vote.peer;
          if (p._ === 'peerUser') {
            const user = users.get(String(p.userId));
            const name =
              user?._ === 'user'
                ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username
                : '';
            return {
              id: `user:${p.userId}`,
              name: name || 'Unnamed participant',
              votedAt: vote.date,
            };
          }
          const chatId = p._ === 'peerChannel' ? p.channelId : p.chatId;
          const chat = chats.get(String(chatId));
          return {
            id: `${p._}:${chatId}`,
            name: (chat && 'title' in chat && chat.title) || 'Unnamed chat',
            votedAt: vote.date,
          };
        });
        return { people, count: page.count, nextOffset: page.nextOffset };
      }, answer.result?.voters);
      Object.assign(names, voters.names);
      // Multiple choices can repeat a peer; retain the latest reported vote time.
      for (const [id, time] of Object.entries(voters.votedAt))
        votedAt[id] = Math.max(votedAt[id] ?? 0, time);
      options.push({ text: answer.text, voters: voters.ids });
    }
    checks.push({ peer, messageId, fingerprint: fingerprint(poll) });
    polls.push({ title: poll.question, options, votedAt });
  }
  progress('Checking result completeness…');
  for (const check of checks) {
    const [message] = await getMessages(client, check.peer, check.messageId);
    if (message?.media?.type !== 'poll' || fingerprint(message.media) !== check.fingerprint) {
      throw new UserFacingError('A poll changed while loading. Refresh the results again.');
    }
  }
  return { polls, names };
}
