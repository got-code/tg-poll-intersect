# Poll Intersections

Compare four Telegram group polls: topic, date, time and place. The build is a self-contained `dist/index.html` with no application backend, analytics or runtime CDN.

## Use

Use non-anonymous polls in a group your account can access. Enter your [Telegram API keys](https://my.telegram.org/apps) once, then choose phone or QR sign-in. QR requires another device already signed in to Telegram; either method may require your 2FA password.

Paste the poll links and select **Refresh results**, or try **Demo** with ten dates, topics and people and three times and places. For consecutive messages, enter only the first link; a manual link starts a new sequence. Results are grouped by date. An unanswered poll assumes all its options; an explicit vote never assumes other options. Dashed names mark implicit votes for that row. Every name shows all four vote times in your local time zone, missing votes first, then its Telegram ID. **Minimum people per topic** filters topics and dates; zero shows all. CSV exports the visible results without Telegram IDs.

Saved, valid links start collapsed; use **Edit** to change them. The fields collapse after a successful refresh and reopen for link validation errors. **Refresh results** and **Demo** remain available while collapsed.

Topics are ranked by total participants, then by explicit participants; complete ties keep poll order.

Telegram may require you to vote first and does not expose channel voter lists. Polls can change while results are loading.

## Data

Links and the topic minimum are saved in this browser. **Remember login** encrypts the session and API keys with a separate password. Passwords, login codes and encryption keys are never persisted. Votes and QR tokens stay in memory; reload clears results and locks the saved login. Data does not sync between browsers or devices.

**Sign out** removes the saved login and attempts server logout. Closing a tab does not revoke the session; manage it in **Telegram → Settings → Devices**. Sessions have full account permissions. Encryption protects the stored copy, not an unlocked page. The app connects directly to Telegram, never votes or sends messages, and may read your chat list to resolve private links.

## Develop

Use Node.js 24 and the pnpm version in `package.json`:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install --with-deps chromium
pnpm check
```

`pnpm check` builds the app and runs the Node.js and Chromium tests using synthetic Telegram responses. Browser tests cover mobile and desktop widths in both themes. To use an installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Auth RPC diagnostics appear in the console under `[Telegram`; secrets and response bodies are excluded.

### Development rules

- Agree on a plan before implementation. Keep product copy English and branding neutral.
- Keep domain logic independent of browser and network APIs; use small cohesive modules.
- Preserve the privacy and storage contracts, locked dependencies and bundled license notices.
- Keep every necessary test in the repository as automated code; remove temporary scripts. Run `pnpm check`, including browser assertions for mobile, desktop and both color schemes. State what was verified.
- Keep documentation brief and operational; avoid duplicating implementation details or platform documentation.
- Maintain these rules when requirements change. Put shared requirements here and agent-only instructions in `AGENTS.md`.
