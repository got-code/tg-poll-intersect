import { createAuthSession } from './modules/auth/index.ts';
import { createPollResults } from './modules/polls/index.ts';
import { auth, createClient, preloadAuth } from './modules/auth/infrastructure/gateway.ts';
import { createPollSource, preloadPolls } from './modules/polls/infrastructure/source.ts';
import { demo } from './modules/polls/infrastructure/demo.ts';
import * as sessions from './modules/auth/infrastructure/saved-session.ts';
import * as preferences from './modules/polls/infrastructure/preferences.ts';
import { startApp } from './presentation/app.ts';
import { explainError } from './presentation/errors.ts';

const authSession = createAuthSession({ createClient, auth, sessions });
const results = createPollResults({
  source: createPollSource(() => authSession.getClient()),
  demo,
});
startApp({
  authSession,
  results,
  preferences,
  explainError,
  prepareLogin: () => Promise.all([preloadAuth(), preloadPolls()]).then(() => {}),
});
