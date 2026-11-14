import { createAuthSession } from '../../src/application/auth-session.ts';
import { startApp } from '../../src/ui/app.ts';
import * as sessions from '../../src/infrastructure/session.ts';
import * as preferences from '../../src/infrastructure/preferences.ts';

// Real application and persistence with an injected synthetic Telegram transport.
export function mountTestApp({ createClient, auth, fetchPolls }) {
  const authSession = createAuthSession({ createClient, auth, sessions });
  startApp({
    authSession,
    preferences,
    explainError: (error) => error.message,
    loadPolls: (links, progress) => fetchPolls(authSession.getClient(), links, progress),
  });
}
