import { createAuthSession } from '../../src/modules/auth/application/session.ts';
import { createPollResults } from '../../src/modules/polls/application/results.ts';
import { demo } from '../../src/modules/polls/infrastructure/demo.ts';
import { startApp } from '../../src/presentation/app.ts';
import * as sessions from '../../src/modules/auth/infrastructure/saved-session.ts';
import * as preferences from '../../src/modules/polls/infrastructure/preferences.ts';

// Real application and persistence with an injected synthetic Telegram transport.
export function mountTestApp({ createClient, auth, fetchPolls, prepareLogin }) {
  const authSession = createAuthSession({ createClient, auth, sessions });
  const results = createPollResults({
    source: { load: (links, progress) => fetchPolls(authSession.getClient(), links, progress) },
    demo,
  });
  startApp({
    authSession,
    results,
    preferences,
    explainError: (error) => error.message,
    prepareLogin,
  });
}
