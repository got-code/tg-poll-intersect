import { createAuthController } from '../modules/auth/presentation/controller.ts';
import { createPollController } from '../modules/polls/presentation/controller.ts';
import { createStatus, elements } from './dom.ts';
import type { AuthSession } from '../modules/auth/index.ts';
import type { PollResults, PreferencesStore } from '../modules/polls/index.ts';

interface AppDependencies {
  authSession: AuthSession;
  results: PollResults;
  preferences: PreferencesStore;
  explainError(this: void, error: unknown): string;
  prepareLogin?(this: void): Promise<void>;
}

export function startApp({
  authSession,
  results,
  preferences,
  explainError,
  prepareLogin = async () => {},
}: AppDependencies) {
  const $ = elements<{ status: HTMLElement }>();
  const notify = createStatus($('status'));
  const auth = createAuthController({
    session: authSession,
    explainError,
    prepareLogin,
    notify,
    onSignOut: () => polls.clear(authSession.hasSavedLogin()),
  });
  const polls = createPollController({
    results,
    preferences,
    explainError,
    notify,
    isConnected: authSession.isConnected,
    openLogin: auth.openLogin,
    onBusyChange: auth.setDisabled,
  });
}
