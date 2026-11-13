# Poll Intersections

A browser app for comparing four Telegram group polls: topic, date, time and place. No application backend, analytics or runtime CDN. The build is a self-contained `dist/index.html`, including Telegram’s client library, WASM and dependency licenses.

## Use

Open the site and try **Demo**, or paste your poll links and select **Refresh results**. If the messages are consecutive, enter only the topic link: empty fields use the next message after the preceding poll. A manual link starts a new sequence. **Clear links** appears when two or more fields are filled manually.

Use non-anonymous polls in a group your account can access. Obtain your own API ID and API hash from [Telegram](https://my.telegram.org/apps), then sign in through the app. Telegram may require you to vote first and [does not expose channel voter lists](https://core.telegram.org/method/messages.getPollVotes). Some specialized sign-in methods are unsupported.

Results are grouped by date. An unanswered poll assumes all its options; a vote for another option never does. Dashed names explain missing votes first, followed by explicit votes. Counts distinguish explicit and implicit participants. **Minimum people per topic** filters topics and dates; zero shows all. CSV exports the visible results, names and separate counts without Telegram IDs.

## Publish on GitHub Pages

1. Create a GitHub repository, such as `poll-intersections`, with `main` as its default branch. A public repository works with GitHub Free.
2. Commit and push the project, including `.github/workflows/pages.yml`, `src`, `test`, `build.mjs`, `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`. Keep `.gitignore`; generated files and dependencies are not committed. Do not upload credentials, sessions or exported results.
3. Open **Settings → Pages → Build and deployment → Source**, and select **GitHub Actions**.
4. Open **Actions → Check and publish → Run workflow** on `main`, or push another commit. The workflow installs locked dependencies, builds, tests and publishes `dist` only after checks pass. Pull requests run checks without publishing.
5. Open the URL shown under **Settings → Pages**, usually `https://YOUR-USERNAME.github.io/poll-intersections/`. Open that same HTTPS URL in your phone’s browser; you can bookmark it or add it to your home screen.

The app works under a repository subpath without a base URL setting. No Telegram secrets or application environment variables are needed in GitHub Actions. Sign in separately on each device; browser storage does not sync. You can also open the built HTML locally, although mobile file handlers vary; HTTPS is the intended mobile entry point.

See GitHub’s instructions for [publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) and [custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). A local build verifies the artifact; deployment is verified only after the GitHub workflow succeeds.

## Storage and privacy

- `poll-intersections.preferences.v1` stores manual links and the topic minimum in localStorage. Automatic links are derived, not saved as manual values.
- **Remember login** stores an encrypted session and API keys under `poll-intersections.session.v1`: AES-256-GCM, a random 12-byte IV, PBKDF2-SHA256 with 600,000 iterations and a random 16-byte salt. Passwords, Telegram codes and derived keys are not persisted. The SDK uses memory storage after unlocking.
- Votes stay in memory until you export CSV. Reloading clears results and locks the saved login. **Sign out** removes it and attempts server logout. Closing a tab does not revoke the Telegram session; manage sessions in **Telegram → Settings → Devices**.
- Browser storage is scoped to the site and browser profile. Disabled or full storage prevents persistence. Encryption protects the stored copy; an unlocked page has access to the session, which has account permissions rather than a read-only scope.
- Connections go directly to Telegram. Private links may require reading your dialog list. No messages are sent and no votes are cast. The CSP allows only the bundled script and Telegram WebSocket endpoints. Dependencies and licenses are embedded; this app has not been independently audited.

To move links from an older build without migration code: open its DevTools → **Application → Local Storage**, copy the four-link JSON array, then open the new site’s storage. Create `poll-intersections.preferences.v1` with `{"links":COPIED_ARRAY,"topicMinimum":3}` (replace `COPIED_ARRAY` with the actual array) and reload. You can instead paste the links into the form. Sign in again on the new build; old encrypted logins are not migrated.

## Develop

Use Node.js 24 and the pnpm version declared in `package.json`:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

To preview over HTTP, run `python3 -m http.server 8080 --directory dist` and open `http://localhost:8080/`. Also check the page beneath a subpath before publication.

- `src/domain/`: pure link handling, grouping, filtering and CSV.
- `src/infrastructure/`: Telegram access, voter pagination and persistence.
- `src/ui/`: form, authentication, rendering and browser interactions.
- `src/main.mjs`: entry point; `src/index.html` and `src/styles.css`: layout and styles.
- `test/`: domain, rendering, persistence, authentication and bundled SDK checks.

Tests use synthetic Telegram responses and sessions. UI checks should cover narrow screens, both color schemes, keyboard/touch tooltips and reload persistence. Real account login and poll access require a separate manual check. Telegram provides no atomic snapshot across polls; vote changes that preserve counts can escape consistency checks.

For sign-in diagnostics, open DevTools → **Console**, enable **Info** messages and filter by `[Telegram`. Authentication RPCs log the method, response constructor, code delivery/next delivery, timeout and recognized errors. Request parameters, phone numbers, API credentials, codes, code hashes, passwords, sessions and response bodies are excluded. These diagnostics do not confirm actual code delivery. Reload the rebuilt page before reproducing an issue.

### Development rules

- Agree on a plan before implementation. Keep product copy English and branding neutral.
- Follow established software engineering, web accessibility and security standards. Keep domain logic independent of browser and network APIs; use small cohesive modules and proportionate abstractions.
- Preserve the documented privacy and storage contracts. Keep dependencies locked and preserve bundled license notices.
- Test behavior and failure boundaries affected by a change. Run `pnpm check`; inspect UI changes in a browser at mobile and desktop widths, in both color schemes. State what was actually verified.
- Keep documentation minimal and operational; do not duplicate implementation logic or restate industry standards. Prefer documented manual steps to one-off migration code.
- Record durable development requirements here, including this requirement to maintain the rules. Update affected instructions with the same change. Reserve `AGENTS.md` for agent-specific instructions; requirements shared by human and automated contributors belong here and must not be duplicated there.
