import { UserFacingError } from '../domain/errors.mjs';
import { BaseTelegramClient, MemoryStorage, WebCryptoProvider, WebPlatform, MtPeerNotFoundError } from '@mtcute/web';
import { sendCode, signIn, signInQr, checkPassword, getMe, getMessages, resolvePeer, iterDialogs, logOut } from '@mtcute/web/methods.js';
import { readVoters } from './voters.mjs';
import { createTelegramDiagnostics } from './telegram-diagnostics.mjs';

const traceCall = createTelegramDiagnostics();

// Replaced with bundled bytes at build time. No runtime fetch for WASM.
const WASM_BASE64 = '__WASM_BASE64__';
let wasmModule;
export const makeCrypto = () => new WebCryptoProvider({
  wasmInput: wasmModule ??= new WebAssembly.Module(Uint8Array.from(atob(WASM_BASE64), char => char.charCodeAt(0))),
});

class Client extends BaseTelegramClient {
  call(method, options) {
    return traceCall(method, () => super.call(method, { timeout: 30000, floodSleepThreshold: 0, maxRetryCount: 0, ...options }));
  }
}
class LocalPlatform extends WebPlatform {
  // Do not let the SDK probe localStorage for log settings; file:// may deny it.
  getDefaultLogLevel() { return 0; }
}

export function createClient(apiId, apiHash, { qrLogin = false } = {}) {
  return new Client({
    apiId, apiHash,
    storage: new MemoryStorage(),
    platform: new LocalPlatform(),
    crypto: makeCrypto(),
    logLevel: 0,
    // QR authorization needs updateLoginToken; keep chat update processing off.
    disableUpdates: !qrLogin,
    updates: false,
    initConnectionOptions: { deviceModel: 'Poll Intersections', appVersion: '0.2', systemVersion: 'Browser' },
  });
}

export const auth = {
  sendCode: (client, phone) => sendCode(client, { phone }),
  signIn: (client, phone, phoneCodeHash, phoneCode) => signIn(client, { phone, phoneCodeHash, phoneCode }),
  qr: (client, options) => signInQr(client, options),
  password: (client, password) => checkPassword(client, password),
  logout: client => logOut(client),
  me: client => getMe(client),
};

async function findPeer(client, id) {
  try { return await resolvePeer(client, id); }
  catch (error) {
    if (typeof id !== 'number' || !(error instanceof MtPeerNotFoundError)) throw error;
    // Private links contain no access_hash. Resolve joined chats via the dialog list.
    for await (const dialog of iterDialogs(client, { archived: 'keep' })) {
      if (dialog.chat.id === id) return resolvePeer(client, id);
    }
    throw new UserFacingError('The group was not found in your chats. Check the link and your access.');
  }
}

function fingerprint(poll) {
  return JSON.stringify([String(poll.id), poll.question, poll.answers.map(answer => [
    answer.text, Array.from(answer.data), answer.result?.voters ?? null,
  ])]);
}

export async function fetchPolls(client, links, progress) {
  const polls = [], names = {}, checks = [];
  for (let i = 0; i < links.length; i++) {
    progress(`Poll ${i + 1} of 4: loading votes…`);
    const { peer: id, messageId } = links[i];
    const peer = await findPeer(client, id);
    const [message] = await getMessages(client, peer, messageId);
    const poll = message?.media;
    if (poll?.type !== 'poll') throw new UserFacingError(`Link ${i + 1}: the message does not contain a poll.`);
    if (!poll.isPublic) throw new UserFacingError(`Poll ${i + 1} is anonymous. Voter intersections are unavailable.`);
    const options = [], votedAt = {};
    for (const answer of poll.answers) {
      const voters = await readVoters(async offset => {
        const page = await client.call({ _: 'messages.getPollVotes', peer, id: messageId, option: answer.data, offset, limit: 100 });
        const users = new Map(page.users.map(user => [String(user.id), user]));
        const chats = new Map(page.chats.map(chat => [String(chat.id), chat]));
        const people = page.votes.map(vote => {
          const p = vote.peer;
          if (p._ === 'peerUser') {
            const user = users.get(String(p.userId));
            return { id: `user:${p.userId}`, name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || 'Unnamed participant', votedAt: vote.date };
          }
          const chatId = p.channelId ?? p.chatId;
          const chat = chats.get(String(chatId));
          return { id: `${p._}:${chatId}`, name: chat?.title || 'Unnamed chat', votedAt: vote.date };
        });
        return { people, count: page.count, nextOffset: page.nextOffset };
      }, answer.result?.voters);
      Object.assign(names, voters.names);
      // Multiple choices can repeat a peer; retain the latest reported vote time.
      for (const [id, time] of Object.entries(voters.votedAt)) votedAt[id] = Math.max(votedAt[id] ?? 0, time);
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

export function explainError(error) {
  const code = error?.text || error?.message || '';
  const known = [
    ['POLL_VOTE_REQUIRED', 'Vote in each poll in Telegram first, then refresh the results.'],
    ['BROADCAST_FORBIDDEN', 'Telegram does not expose voter lists in channels. Use polls in a group.'],
    ['API_ID_INVALID', 'Check your API ID and API hash from my.telegram.org/apps.'],
    ['API_ID_PUBLISHED_FLOOD', 'Telegram rejected these API keys. Use your own application’s keys.'],
    ['PHONE_NUMBER_INVALID', 'Check the phone number, including the country code.'],
    ['PHONE_CODE_INVALID', 'Incorrect code. Check the code from Telegram.'],
    ['PHONE_CODE_EXPIRED', 'The code expired. Close the dialog and start signing in again.'],
    ['AUTH_TOKEN_EXPIRED', 'The QR code expired. Show a new QR code and scan it again.'],
    ['AUTH_TOKEN_INVALID', 'The QR code is no longer valid. Show a new QR code and scan it again.'],
    ['PASSWORD_HASH_INVALID', 'Incorrect two-step verification password.'],
    ['AUTH_RESTART', 'Telegram requires a fresh login. Close the dialog and try again.'],
    ['SESSION_REVOKED', 'The session was revoked. Sign out and sign in again.'],
    ['AUTH_KEY_UNREGISTERED', 'The login expired. Sign out and sign in again.'],
    ['CHANNEL_PRIVATE', 'This account does not have access to the group.'],
    ['MSG_ID_INVALID', 'The poll message was not found. Check the link.'],
    ['timed out', 'Telegram did not respond within 30 seconds. Check your connection and retry.'],
  ];
  for (const [match, text] of known) if (code.includes(match) || error?.name?.includes(match)) return text;
  if (/FLOOD|SLOWMODE/.test(code)) return 'Telegram is limiting requests. Wait before trying again.';
  // Show local validation errors, but never dump a raw API payload or credentials.
  if (error instanceof UserFacingError) return error.message;
  return 'The request failed. Check your connection and poll access, then try again.';
}
