import { UserFacingError } from '../../../application/errors.ts';
import { lazyTelegram } from '../../../infrastructure/telegram/loader.ts';
import type { BaseTelegramClient } from '@mtcute/web';
import type { PollSource } from '../application/source.ts';

const load = lazyTelegram(() => import('./telegram.ts'));

export const preloadPolls = () => load().then(() => {});

export function createPollSource(getClient: () => BaseTelegramClient | null): PollSource {
  return {
    async load(links, progress) {
      const client = getClient();
      if (!client) throw new UserFacingError('Sign in to Telegram first.');
      return (await load()).fetchPolls(client, links, progress);
    },
  };
}
