# Poll Intersections

Compare four Telegram group polls: topic, date, time and place.
[Open the app](https://got-code.github.io/tg-poll-intersect/).

## Requirements

Use non-anonymous polls in a group your account can access, and your own
[Telegram API keys](https://my.telegram.org/apps). Phone and QR sign-in support
2FA; QR requires another device already signed in to Telegram. Telegram may
require you to vote first and does not expose channel voter lists.

An unanswered poll assumes all its options. Implicit matches are assumptions,
not explicit votes. Results include anyone who answered at least one poll.

## Run locally

Use Node.js 24 and the pnpm version pinned in `package.json`:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

Open [127.0.0.1:3000](http://127.0.0.1:3000). Vite provides its standard development
server, dependency cache, CSS hot updates and automatic page reloads.
To stop the dev server cleanly, press `q` then Enter in its terminal. Press `h`
then Enter to list Vite's terminal shortcuts.

`pnpm build` creates the static site in `dist/`. `pnpm start` previews that existing
build without rebuilding; run the build command again when you need a newer preview.
Use `pnpm dev --port 3001` or `pnpm start --port 3001` for another port.
GitHub Actions publishes successful builds from `main` to GitHub Pages.

## Privacy

The app connects directly to Telegram, with no application backend, analytics or
runtime CDN. It never votes or sends messages; it may read your chat list to resolve
private links. Votes and QR tokens stay in memory. CSV excludes Telegram IDs.

Links and the topic minimum are saved in this browser. Optional remembered login
encrypts the session and API keys with a separate password. Passwords, login codes
and encryption keys are never persisted. Reload clears results and locks the saved
login. Data does not sync between browsers or devices.

Sign out removes the saved login and attempts server logout. Closing a tab does
not revoke the session; manage it in Telegram → Settings → Devices. Sessions have
full account permissions. Encryption protects the stored copy, not an unlocked page.

## Develop

`pnpm format` formats the repository. `pnpm format:check`, `pnpm typecheck` and
`pnpm lint` check formatting, strict TypeScript contracts and code quality.
`pnpm test` runs Node tests; `pnpm check` runs the full suite, including the build
and Chromium tests with synthetic Telegram responses.

Before the first browser test, install Chromium:

```sh
pnpm exec playwright install --with-deps chromium
```

For an installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
Auth RPC diagnostics and poll-read failures appear in the console under `[Telegram`.
They preserve safe error codes and timing, excluding secrets, identifiers and response bodies.

Read the [development rules](CONTRIBUTING.md) before making changes.
