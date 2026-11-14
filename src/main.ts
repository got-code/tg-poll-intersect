import { createAuthSession } from './application/auth-session.ts';
import { createClient } from './infrastructure/telegram/client.ts';
import { auth } from './infrastructure/telegram/auth.ts';
import { fetchPolls } from './infrastructure/telegram/polls.ts';
import * as sessions from './infrastructure/session.ts';
import * as preferences from './infrastructure/preferences.ts';
import { startApp } from './ui/app.ts';
import { explainError } from './ui/errors.ts';
import { UserFacingError } from './domain/errors.ts';

const authSession = createAuthSession({ createClient, auth, sessions });
startApp({
  authSession,
  preferences,
  explainError,
  loadPolls: (links, progress) => {
    const client = authSession.getClient();
    if (!client) throw new UserFacingError('Sign in to Telegram first.');
    return fetchPolls(client, links, progress);
  },
});
