import { UserFacingError } from '../../application/errors.ts';

export function lazyTelegram<T>(load: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch(() => {
      pending = undefined;
      throw new UserFacingError(
        'Could not load Telegram support. Check your connection and try again. Reload the page if the problem continues.',
      );
    });
    return pending;
  };
}
