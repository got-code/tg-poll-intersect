import { chromium } from 'playwright';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { decodeQR } from 'qr/decode.js';
import assert from 'node:assert/strict';
import { createServer, preview } from 'vite';

// Use the real UI, QR encoder and encryption, replacing only Telegram's network.
// Vite previews the production build and serves one synthetic transport fixture.
const fixture = await build({
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'js',
    contents: `
    import { mountTestApp } from './test/fixtures/app.mjs';
    import { linkIdentity } from './src/modules/polls/application/links.ts';
    import { PasswordRequiredError } from './src/application/errors.ts';
    window.requirePassword = () => window.qrTest.reject(new PasswordRequiredError());
    mountTestApp({
      createClient: (id, hash) => ({
        async getApiCredentials() { return {id, hash}; },
        async exportSession() { return 'SYNTHETIC_SESSION_FOR_BROWSER_TEST'; },
        async importSession(session) { window.importedSession = session; },
        async destroy() { window.destroyed = (window.destroyed || 0) + 1; },
      }),
      auth: {
        sendCode: async () => ({codeToken:'fake-code-hash', delivery:'app'}),
        signIn: async () => ({displayName:'Test'}),
        qr: (client, options) => new Promise((resolve, reject) => {
          window.qrTest = {options, resolve, reject};
          options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason), {once:true});
          options.onUrlUpdated('tg://login?token=SYNTHETIC_FIRST_TOKEN', new Date(Date.now() + 30000));
        }),
        password: async (client, password) => {
          if (password !== 'correct 2FA') throw new Error('Incorrect two-step verification password.');
          return {displayName:'Test'};
        },
        me: async () => ({displayName:'Test'}), logout: async () => {},
      },
      fetchPolls: (client, links) => {
        if (!window.allowPollFetch) throw new Error('Unexpected poll request');
        if (window.pollRequestError) throw new Error('Synthetic request failure');
        window.pollFetchCount = (window.pollFetchCount || 0) + 1;
        window.lastPollIds = links.map(linkIdentity);
        return {names:{'1':'First', '2':'Second', '3':'Third'}, polls:links.map((link, index) => ({...window.pollFixtures?.[index], id:linkIdentity(link), title:window.pollFixtures?.[index]?.title ?? 'Synthetic question ' + (index + 1), options:window.pollFixtures?.[index]?.options ?? [{text:'Synthetic option', voters:['1','2','3']}]}))};
      },
    });
  `,
  },
});
const script = fixture.outputFiles[0].text;
const escapedScript = script.replace(/<\/script/gi, '<\\/script');
const hash = createHash('sha256').update(escapedScript).digest('base64');
const styles = new Map(
  await Promise.all(
    [
      'presentation/styles.css',
      'modules/auth/presentation/styles.css',
      'modules/polls/presentation/styles.css',
    ].map(async (path) => [path, await readFile(`src/${path}`, 'utf8')]),
  ),
);
const html = (await readFile('src/index.html', 'utf8'))
  .replace(
    /<script\b[^>]*src="\/main\.ts"[^>]*>\s*<\/script>/,
    () => `<script>${escapedScript}</script>`,
  )
  .replace(/<link\b[^>]*href="\/([^" ]+\.css)"[^>]*>/g, (_match, path) => {
    assert.ok(styles.has(path), path);
    return `<style>${styles.get(path)}</style>`;
  })
  .replace("script-src 'self'", `script-src 'sha256-${hash}'`);
const buildMtime = (await stat('dist/index.html')).mtimeMs;
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const authAsset = manifest['modules/auth/infrastructure/telegram.ts'].file;
const pollAsset = manifest['modules/polls/infrastructure/telegram.ts'].file;
const production = await preview({
  logLevel: 'error',
  preview: { port: 0 },
  plugins: [
    {
      name: 'synthetic-telegram-fixture',
      configurePreviewServer(server) {
        server.middlewares.use('/fixture', (_request, response) => {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(html);
        });
      },
    },
  ],
});
const server = production.httpServer;
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
let cases = 0;
async function checkLazyTelegram() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  const sockets = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.violations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.violations.push(event.violatedDirective),
    );
  });
  const release = Promise.withResolvers();
  await page.route(`${origin}/${authAsset}`, async (route) => {
    await release.promise;
    await route.continue();
  });
  try {
    await page.goto(origin);
    await page.locator('#demo').click();
    assert.equal(await page.locator('.group-card').count(), 10);
    assert.equal(
      requests.some(
        (url) => url.endsWith(authAsset) || url.endsWith(pollAsset) || url.endsWith('.wasm'),
      ),
      false,
    );
    assert.deepEqual(sockets, []);

    const waiting = page.waitForRequest(`${origin}/${authAsset}`);
    await page.locator('#connect').click();
    await waiting;
    assert.equal(await page.locator('#login').isVisible(), true);
    // Submit before preloading completes, then cancel while the same load is pending.
    await page.locator('#apiId').fill('12345');
    await page.locator('#apiHash').fill('abcdef0123456789abcdef0123456789');
    await page.locator('#phone').fill('+381123456789');
    await page.locator('#loginSubmit').click();
    assert.equal(await page.locator('#loginSubmit').isDisabled(), true);
    await page.locator('#cancelLogin').click();
    release.resolve();
    await page.evaluate(
      async (urls) => {
        await Promise.all(urls.map((url) => import(url)));
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
      [`${origin}/${authAsset}`, `${origin}/${pollAsset}`],
    );
    assert.equal(requests.filter((url) => url.endsWith(authAsset)).length, 1);
    assert.equal(await page.locator('#login').isVisible(), false);
    assert.equal(await page.locator('#disconnect').isVisible(), false);
    assert.equal(await page.locator('#apiHash').inputValue(), '');
    assert.equal(
      await page.evaluate(() => localStorage.getItem('poll-intersections.session.v1')),
      null,
    );
    assert.deepEqual(sockets, [], 'Cancelled loading must not connect to an account');
    assert.deepEqual(await page.evaluate(() => window.violations), []);
  } finally {
    release.resolve();
    await context.close();
  }

  const failed = await browser.newContext();
  const retry = await failed.newPage();
  retry.on('pageerror', (error) => errors.push(error.message));
  retry.on('websocket', (socket) => sockets.push(socket.url()));
  try {
    await retry.route(`${origin}/${authAsset}`, (route) => route.abort('failed'));
    await retry.goto(origin);
    await retry.locator('#connect').click();
    await retry.locator('#apiId').fill('12345');
    await retry.locator('#apiHash').fill('abcdef0123456789abcdef0123456789');
    await retry.locator('#phone').fill('+381123456789');
    await retry.locator('#loginSubmit').click();
    await retry.waitForFunction(() =>
      document
        .getElementById('loginStatus')
        .textContent.includes('Could not load Telegram support'),
    );
    assert.equal(await retry.locator('#loginSubmit').isEnabled(), true);
    await retry.locator('#cancelLogin').click();
    await retry.unroute(`${origin}/${authAsset}`);
    await retry.reload();
    await retry.locator('#connect').click();
    await retry.evaluate(async (url) => {
      await import(url);
    }, `${origin}/${authAsset}`);
    assert.equal(await retry.locator('#login').isVisible(), true);
    assert.deepEqual(sockets, [], 'Preloading code must not connect to an account');
  } finally {
    await failed.close();
  }
}
async function openQr(page, remember = false) {
  await page.locator('#connect').click();
  await page.locator('#apiId').fill('12345');
  await page.locator('#apiHash').fill('abcdef0123456789abcdef0123456789');
  await page.locator('#remember').setChecked(remember);
  await page.locator('#qrLogin').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#apiId').inputValue(), '12345');
  assert.equal(await page.locator('#apiHash').inputValue(), 'abcdef0123456789abcdef0123456789');
}
async function decoded(page) {
  await page.waitForFunction(() => {
    const img = document.getElementById('qrCode');
    return img.complete && img.naturalWidth > 0;
  });
  const image = await page.locator('#qrCode').evaluate((img) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      data: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data),
    };
  });
  return decodeQR({ ...image, data: Uint8Array.from(image.data) });
}
async function checkTextContrast(page) {
  const ratios = await page.evaluate(() => {
    const luminance = (color) => {
      const linear = color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const c = value / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const contrast = (foreground, background) => {
      const [a, b] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (a + 0.05) / (b + 0.05);
    };
    const input = document.getElementById('link0');
    return {
      placeholder: contrast(
        getComputedStyle(input, '::placeholder').color,
        getComputedStyle(input).backgroundColor,
      ),
      muted: contrast(
        getComputedStyle(document.getElementById('resultMeta')).color,
        getComputedStyle(document.documentElement).backgroundColor,
      ),
    };
  });
  for (const [name, ratio] of Object.entries(ratios))
    assert.ok(ratio >= 4.5, `${name} contrast ${ratio}:1 is below 4.5:1`);
}
async function setSettingsExpanded(page, expanded) {
  const toggle = page.locator('#pollLinksToggle');
  if ((await toggle.getAttribute('aria-expanded')) !== String(expanded)) await toggle.click();
}

async function checkSettingsDisclosure(page) {
  const help = page.locator('#viewHelp');
  const toggle = page.locator('#pollLinksToggle');
  const load = page.locator('#refresh');
  const originalButton = await load.elementHandle();
  assert.equal(await load.innerText(), 'Load polls');
  assert.equal(await help.isVisible(), true);
  assert.equal(await help.locator('summary').count(), 0);
  const helpBox = await help.boundingBox();
  const controlsBox = await page.locator('.view-controls').boundingBox();
  const toggleBox = await toggle.boundingBox();
  const linksBox = await page.locator('#pollLinkFields').boundingBox();
  const loadBox = await load.boundingBox();
  const settingsBox = await page.locator('.view-settings').boundingBox();
  assert.ok(linksBox.y + linksBox.height <= loadBox.y);
  assert.ok(loadBox.y + loadBox.height <= settingsBox.y);
  assert.ok(controlsBox.y + controlsBox.height <= helpBox.y);
  assert.ok(helpBox.y + helpBox.height <= toggleBox.y);
  await page.locator('.remove-poll').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await load.evaluate((node) => document.activeElement === node), true);
  await page.keyboard.press('Tab');
  assert.equal(
    await page.locator('#demo').evaluate((node) => document.activeElement === node),
    true,
  );
  const stored = await page.evaluate(() =>
    localStorage.getItem('poll-intersections.preferences.v1'),
  );
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await help.isVisible(), false);
  assert.equal(await page.locator('#filterExample').isVisible(), false);
  assert.equal(await page.locator('#demo').isVisible(), false);
  assert.equal(await page.locator('#demoExample').isVisible(), false);
  assert.equal(await page.locator('.view-controls').isVisible(), false);
  assert.equal(await load.isVisible(), true);
  assert.equal(await load.count(), 1);
  assert.equal(
    await page.evaluate((button) => button === document.getElementById('refresh'), originalButton),
    true,
  );
  const [collapsedLoadBox, collapsedToggleBox] = await page.evaluate(() =>
    ['refresh', 'pollLinksToggle'].map((id) =>
      document.getElementById(id).getBoundingClientRect().toJSON(),
    ),
  );
  assert.ok(
    Math.abs(collapsedLoadBox.y - collapsedToggleBox.y) < 1,
    JSON.stringify({ collapsedLoadBox, collapsedToggleBox }),
  );
  assert.ok(collapsedLoadBox.x + collapsedLoadBox.width <= collapsedToggleBox.x);
  await load.focus();
  await page.keyboard.press('Tab');
  assert.equal(await toggle.evaluate((node) => document.activeElement === node), true);
  await toggle.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await help.isVisible(), true);
  assert.equal(await page.locator('#filterExample').isVisible(), true);
  assert.equal(await page.locator('#demo').isVisible(), true);
  assert.equal(await load.count(), 1);
  assert.equal(
    await page.evaluate((button) => button === document.getElementById('refresh'), originalButton),
    true,
  );
  assert.equal(await page.locator('#filterBy').getAttribute('aria-describedby'), 'filterByHint');
  assert.equal(await page.locator('#groupBy').getAttribute('aria-describedby'), 'groupByHint');
  await toggle.press('Space');
  assert.equal(await help.isVisible(), false);
  await toggle.press('Space');
  assert.equal(await help.isVisible(), true);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('poll-intersections.preferences.v1')),
    stored,
  );
  await originalButton.dispose();
}

async function checkRepeatedPollActions(page) {
  const add = page.locator('#addPoll');
  const removes = page.locator('.remove-poll');
  const fields = page.locator('.poll-link');
  const focused = (locator) => locator.evaluate((node) => document.activeElement === node);
  await add.scrollIntoViewIfNeeded();
  const addBox = await add.boundingBox();
  assert.ok(addBox);
  let count = await fields.count();
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(addBox.x + addBox.width / 2, addBox.y + addBox.height / 2);
    assert.equal(await fields.count(), ++count);
    assert.equal(await focused(add), true);
    const box = await add.boundingBox();
    assert.equal(box.x, addBox.x);
    assert.equal(box.y, addBox.y);
  }
  for (const key of ['Enter', 'Enter', 'Space', 'Space']) {
    await page.keyboard.press(key);
    assert.equal(await fields.count(), ++count);
    assert.equal(await focused(add), true);
  }

  await removes.nth(1).scrollIntoViewIfNeeded();
  const removeBox = await removes.nth(1).boundingBox();
  assert.ok(removeBox);
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(removeBox.x + removeBox.width / 2, removeBox.y + removeBox.height / 2);
    assert.equal(await fields.count(), --count);
    assert.equal(await focused(removes.nth(1)), true);
  }

  await removes.last().focus();
  for (const key of ['Enter', 'Space']) {
    await page.keyboard.press(key);
    assert.equal(await fields.count(), --count);
    assert.equal(await focused(removes.last()), true);
  }
  while (count > 1) {
    await page.keyboard.press('Enter');
    assert.equal(await fields.count(), --count);
    assert.equal(await focused(removes.last()), true);
  }
  assert.equal(await removes.isDisabled(), true);
  assert.equal(await removes.evaluate((button) => button.disabled), false);
  for (const key of ['Enter', 'Space', 'Enter']) await page.keyboard.press(key);
  const lastBox = await removes.boundingBox();
  await page.mouse.click(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2);
  assert.equal(await fields.count(), 1);
  assert.equal(await focused(removes), true);
  assert.equal(await page.locator('#login').isVisible(), false);
  for (const trigger of ['Enter', 'Space', 'mouse']) {
    await page.locator('#link0').fill('https://t.me/groupchat/123');
    assert.equal(await removes.isDisabled(), false);
    await removes.focus();
    if (trigger === 'mouse') {
      const box = await removes.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await page.keyboard.press(trigger);
    }
    assert.equal(await fields.count(), 1);
    assert.equal(await page.locator('#link0').inputValue(), '');
    assert.equal(await focused(removes), true);
    assert.equal(await removes.isDisabled(), true);
    await page.keyboard.press('Enter');
    assert.equal(await fields.count(), 1);
    assert.deepEqual(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('poll-intersections.preferences.v1')).links,
      ),
      [''],
    );
  }
  await page.reload();
  assert.equal(await fields.count(), 1);
  assert.equal(await page.locator('#link0').inputValue(), '');
  assert.equal(await removes.isDisabled(), true);
}

async function checkLinkDisclosure(page, width) {
  const settings = page.locator('#pollLinks');
  const toggle = page.locator('#pollLinksToggle');
  assert.equal(await settings.isVisible(), true);
  await checkSettingsDisclosure(page);
  await checkRepeatedPollActions(page);
  await page.locator('#link0').fill('https://t.me/groupchat/123');
  assert.equal(await page.locator('#viewHelp').isVisible(), true);
  assert.equal(await settings.isVisible(), true);
  await toggle.click();
  assert.equal(await page.locator('#link0').isVisible(), false);
  assert.equal(await page.locator('.settings-expand').isVisible(), true);
  assert.equal(await page.locator('#pollLinksCount').textContent(), ' · 1 poll');
  assert.equal(await page.locator('#refresh').isVisible(), true);
  assert.equal(await page.locator('#demo').isVisible(), false);
  const box = await toggle.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= width);
  assert.ok((await page.locator('#refresh').boundingBox()).height <= 44);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#link0').isVisible(), true);
  await page.reload();
  assert.equal(await settings.isVisible(), false);
  assert.equal(await page.locator('#viewHelp').isVisible(), false);
  assert.equal(await page.locator('.group-card').count(), 0);
  assert.equal(await page.locator('#refresh').isVisible(), true);
  const stored = await page.evaluate(() =>
    localStorage.getItem('poll-intersections.preferences.v1'),
  );
  await toggle.click();
  assert.equal(await page.locator('#viewHelp').isVisible(), true);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('poll-intersections.preferences.v1')),
    stored,
  );
  if (width === 320) {
    await page.locator('#link0').fill('bad');
    await toggle.click();
    await page.locator('#refresh').click();
    assert.equal(await settings.isVisible(), true);
    assert.equal(
      await page.locator('#link0').evaluate((node) => node === document.activeElement),
      true,
    );
    await page.locator('#link0').fill('https://example.com/nope');
    await toggle.click();
    await page.locator('#refresh').click();
    assert.equal(await settings.isVisible(), true);
    assert.equal(
      await page.locator('#link0').evaluate((node) => node === document.activeElement),
      true,
    );
    await page.locator('#link0').fill('https://t.me/groupchat/123');
    await page.locator('#addPoll').click();
    await page.locator('#link1').fill('https://t.me/groupchat/123');
    await toggle.click();
    assert.equal(await page.locator('#clearLinks').isVisible(), false);
    await page.locator('#refresh').click();
    assert.equal(await settings.isVisible(), true);
    assert.equal(
      await page.locator('#link1').evaluate((node) => node === document.activeElement),
      true,
    );
    assert.equal(await page.locator('#login').isVisible(), false);
    await page.locator('#clearLinks').click();
  } else {
    await page.locator('#link0').fill('');
  }
  await page.reload();
  assert.equal(await settings.isVisible(), true);
  assert.equal(await page.locator('#link0').inputValue(), '');
}
async function checkRefreshDisclosure(page) {
  await setSettingsExpanded(page, true);
  await page.locator('#link0').fill('https://t.me/groupchat/123');
  await page.evaluate(() => {
    window.allowPollFetch = true;
  });
  await page.locator('#link0').press('Enter');
  await page.waitForFunction(() =>
    document.getElementById('status').textContent.startsWith('Done.'),
  );
  assert.equal(await page.locator('#pollLinks').isVisible(), true);
  assert.equal(await page.locator('#refresh').innerText(), 'Load polls');
  await setSettingsExpanded(page, false);
  assert.equal(await page.locator('#refresh').isVisible(), true);
  assert.equal(await page.locator('#demo').isVisible(), false);
  const requests = await page.evaluate(() => window.pollFetchCount);
  await page.locator('#refresh').click();
  await page.waitForFunction((count) => window.pollFetchCount === count + 1, requests);
  assert.equal(await page.locator('#pollLinks').isVisible(), false);
  const exported = await downloadCsv(page, 'poll-results.csv');
  assert.ok(exported.includes('First; Second; Third'));
  assert.ok(exported.includes('Synthetic option'));
  await page.evaluate(() => {
    window.pollRequestError = true;
  });
  for (const open of [true, false]) {
    await setSettingsExpanded(page, open);
    await page.locator('#refresh').click();
    await page.waitForFunction(() =>
      document.getElementById('status').textContent.includes('Synthetic request failure'),
    );
    assert.equal(await page.locator('#pollLinks').isVisible(), open);
  }
  await setSettingsExpanded(page, true);
  await page.locator('#addPoll').click();
  await page.locator('#link1').fill('https://t.me/groupchat/124');
  await page.locator('#clearLinks').click();
  assert.equal(await page.locator('#pollLinks').isVisible(), true);
  await page.evaluate(() => localStorage.removeItem('poll-intersections.preferences.v1'));
}
async function downloadCsv(page, filename) {
  const pending = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), filename);
  const stream = await download.createReadStream();
  assert.ok(stream);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const content = Buffer.concat(chunks).toString('utf8');
  assert.ok(
    content.startsWith(
      '\uFEFF"Grouping poll","Group answer","Poll","Option","Total","Explicit","Implicit"',
    ),
  );
  assert.ok(!content.includes('Telegram ID'));
  return content;
}
async function checkCardDisclosure(page, width) {
  const card = page.locator('.group-card').first();
  const heading = card.locator('.group-heading');
  const body = card.locator('.group-body');
  assert.equal(await page.locator('.group-card[open]').count(), 0);
  assert.equal(await heading.isVisible(), true);
  assert.equal(await card.locator('h3').innerText(), '14 November');
  assert.equal(await card.locator('.group-count').innerText(), 'Participants: 5(+3?)');
  assert.equal(await body.isVisible(), false);
  await card.locator('.group-count').click();
  await page.locator('#personTooltip').waitFor({ state: 'visible' });
  assert.equal(await card.evaluate((node) => node.open), false);
  await page.keyboard.press('Escape');
  if (width < 650) await heading.locator('h3').tap();
  else await heading.locator('h3').click();
  assert.equal(await body.isVisible(), true);
  assert.equal(await page.locator('.group-card[open]').count(), 1);
  assert.equal(await page.locator('.group-card').nth(1).locator('.group-body').isVisible(), false);
  await heading.press('Enter');
  assert.equal(await body.isVisible(), false);
  await heading.press('Space');
  assert.equal(await body.isVisible(), true);
}

async function checkDemo(page, width, timeZone) {
  const preferencesHint = await page.locator('#preferencesHint').innerText();
  const savedPreferences = await page.evaluate(() =>
    localStorage.getItem('poll-intersections.preferences.v1'),
  );
  assert.equal(await page.locator('#viewHelp').isVisible(), true);
  await page.locator('#demoExample').click();
  assert.equal(await page.locator('#resultMeta').isVisible(), false);
  assert.equal(await page.locator('.poll-status #demoLabel').isVisible(), true);
  assert.equal(await page.locator('.resulthead #demoLabel').count(), 0);
  assert.equal(
    (await page.locator('.poll-status').innerText()).trim(),
    'Demo · fictional participants and votes',
  );
  assert.equal(
    await page.locator('#demoLabel').innerText(),
    'Demo · fictional participants and votes',
  );
  assert.equal(await page.locator('#status').textContent(), '');
  assert.equal(await page.locator('#status').isVisible(), false);
  assert.equal(await page.locator('#preferencesHint').innerText(), preferencesHint);
  assert.equal(await page.locator('#viewHelp').isVisible(), true);
  assert.equal(await page.locator('#groupBy').inputValue(), 'demo:2');
  assert.equal(await page.locator('#filterBy').inputValue(), 'poll:demo:1');
  assert.equal(await page.locator('#minimumParticipants').inputValue(), '3');
  assert.equal(await page.locator('.group-card').count(), 10);
  await checkCardDisclosure(page, width);
  const example = page
    .locator('.group-card')
    .filter({ has: page.getByRole('heading', { name: '16 November', exact: true }) });
  await example.locator('.group-heading h3').click();
  const topics = example
    .locator('.group-section')
    .filter({ has: page.getByRole('heading', { name: 'What shall we discuss?', exact: true }) });
  const option = (name) =>
    topics
      .locator('.group-option')
      .filter({ has: page.locator('.option-name', { hasText: new RegExp(`^${name}$`) }) });
  assert.equal(await option('Books').locator('.option-count').innerText(), '1(+3?)');
  assert.equal(await option('AI').locator('.option-count').innerText(), '1(+2?)');
  assert.equal(await option('Science').count(), 0);
  await page.locator('#minimumParticipants').fill('5');
  assert.equal(await example.count(), 0);
  await page.locator('#minimumParticipants').fill('0');
  assert.equal(await page.locator('.group-option').count(), 160);
  assert.equal(
    await page
      .locator('.group-card')
      .first()
      .evaluate((node) => node.open),
    true,
  );
  const exported = await downloadCsv(page, 'poll-demo.csv');
  assert.equal(exported.split('\r\n').length, 171);
  assert.ok(exported.includes('Anna Maria Silva'));
  const card = page.locator('.group-card').first();
  const attendees = card.locator('.group-attendees');
  const anna = attendees.getByRole('button', { name: 'Anna Maria Silva', exact: true });
  const tooltip = page.locator('#personTooltip');
  await anna.focus();
  await tooltip.waitFor({ state: 'visible' });
  const expected =
    timeZone === 'UTC'
      ? '“What shall we discuss?” — no vote\n“Which date?” — 12 Nov, 14:51\n“What time?” — 12 Nov, 20:51\n“Where shall we meet?” — 13 Nov, 02:51\nTelegram ID: 6842051937'
      : '“What shall we discuss?” — no vote\n“Which date?” — 12 Nov, 15:51\n“What time?” — 12 Nov, 21:51\n“Where shall we meet?” — 13 Nov, 03:51\nTelegram ID: 6842051937';
  assert.equal(await tooltip.innerText(), expected);
  assert.equal(await anna.getAttribute('class'), 'person');
  assert.equal(await anna.getAttribute('aria-describedby'), 'personTooltip');
  const bounds = await tooltip.boundingBox();
  assert.ok(
    bounds.x >= 0 &&
      bounds.x + bounds.width <= width &&
      bounds.y >= 0 &&
      bounds.y + bounds.height <= 900,
  );
  await page.keyboard.press('Escape');
  assert.equal(await tooltip.isVisible(), false);
  assert.equal(await anna.getAttribute('aria-describedby'), null);
  await page.locator('#demo').focus();
  await anna.hover();
  await tooltip.hover();
  await page.waitForTimeout(250);
  assert.equal(await tooltip.isVisible(), true);
  await page.mouse.move(0, 0);
  await tooltip.waitFor({ state: 'hidden' });

  const books = card
    .locator('.group-option')
    .filter({ has: page.locator('.option-name', { hasText: /^Books$/ }) });
  const topicAnna = books.getByRole('button', { name: 'Anna Maria Silva', exact: true });
  if (width < 650) await topicAnna.tap();
  else await topicAnna.click();
  assert.equal(await topicAnna.getAttribute('class'), 'person implicit');
  assert.equal(await tooltip.innerText(), expected);
  await page.keyboard.press('Escape');

  await attendees.getByRole('button', { name: 'Alex', exact: true }).focus();
  await tooltip.waitFor({ state: 'visible' });
  assert.equal((await tooltip.innerText()).split('\n').length, 5);
  assert.ok(!(await tooltip.innerText()).includes('no vote'));
  await page.keyboard.press('Escape');
  await attendees.getByRole('button', { name: 'Jamie de Vries', exact: true }).focus();
  await tooltip.waitFor({ state: 'visible' });
  assert.ok((await tooltip.innerText()).endsWith('Telegram ID: 3567829012345678'));
  assert.ok(
    (await tooltip.innerText()).startsWith(
      '“Which date?” — no vote\n“What time?” — no vote\n“Where shall we meet?” — no vote\n“What shall we discuss?” — ',
    ),
  );
  await page.keyboard.press('Escape');
  const noorCard = page
    .locator('.group-card')
    .filter({
      has: page.locator('.group-attendees .person', { hasText: /^Noor Ali Hassan$/ }),
    })
    .first();
  await noorCard.locator('.group-heading h3').click();
  assert.equal(await page.locator('.group-card[open]').count(), 2);
  await noorCard.getByRole('button', { name: 'Noor Ali Hassan', exact: true }).first().focus();
  await tooltip.waitFor({ state: 'visible' });
  assert.ok(
    (await tooltip.innerText()).startsWith(
      '“What time?” — no vote\n“Where shall we meet?” — no vote\n“What shall we discuss?” — time unavailable\n“Which date?” — ',
    ),
    await tooltip.innerText(),
  );
  await page.keyboard.press('Escape');
  await noorCard.locator('.group-heading h3').click();
  await card.locator('.group-count').click();
  assert.equal(await card.evaluate((node) => node.open), true);
  assert.equal(await tooltip.innerText(), '3 people have no vote in “Which date?”.\nTotal: 8');
  await page.keyboard.press('Escape');
  await books.locator('.option-count').click();
  assert.equal(
    await tooltip.innerText(),
    '5 people have no vote in “Which date?” or “What shall we discuss?”.\nTotal: 7',
  );
  await page.keyboard.press('Escape');
  await anna.focus();
  await tooltip.waitFor({ state: 'visible' });
  await card.locator('.group-heading h3').click();
  assert.equal(await card.locator('.group-body').isVisible(), false);
  await tooltip.waitFor({ state: 'hidden' });
  await card.locator('.group-heading h3').click();
  await setSettingsExpanded(page, false);
  assert.equal(await card.isVisible(), true);
  assert.equal(await card.locator('.group-body').isVisible(), true);
  if (width === 320 && timeZone === 'UTC')
    await page.screenshot({ path: '/tmp/tg-poll-mobile.png', fullPage: true });
  if (width === 1280 && timeZone !== 'UTC')
    await page.screenshot({ path: '/tmp/tg-poll-desktop.png', fullPage: true });
  await setSettingsExpanded(page, true);
  await page.locator('#minimumParticipants').fill('11');
  assert.equal(await page.locator('.group-card').count(), 0);
  assert.equal(await page.locator('#export').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), [
    'poll-intersections.preferences.v1',
  ]);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('poll-intersections.preferences.v1')),
    savedPreferences,
  );
}
async function checkRemovalInference(page) {
  const first = 'https://t.me/groupchat/123';
  const manual = 'https://t.me/anotherchat/500';
  const inputValues = () =>
    page.locator('.poll-link input').evaluateAll((inputs) => inputs.map((input) => input.value));
  const savedLinks = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem('poll-intersections.preferences.v1')).links,
    );
  await page.locator('#link0').fill(first);
  for (let i = 1; i < 5; i++) await page.locator('#addPoll').click();
  await page.locator('#link3').fill(manual);

  await page.locator('.remove-poll').nth(1).click();
  assert.deepEqual(await inputValues(), [first, '', manual, '']);
  assert.deepEqual(await savedLinks(), [first, '', manual, '']);
  assert.equal(
    await page.locator('#link1').getAttribute('placeholder'),
    'https://t.me/groupchat/124',
  );
  assert.equal(
    await page.locator('#link3').getAttribute('placeholder'),
    'https://t.me/anotherchat/501',
  );

  await page.locator('.remove-poll').last().click();
  assert.deepEqual(await inputValues(), [first, '', manual]);
  assert.deepEqual(await savedLinks(), [first, '', manual]);

  await page.locator('.remove-poll').first().click();
  assert.deepEqual(await inputValues(), ['', manual]);
  assert.deepEqual(await savedLinks(), ['', manual]);

  await page.locator('#clearLinks').click();
  await page.locator('.remove-poll').last().click();
  assert.deepEqual(await inputValues(), ['']);
  assert.equal(await page.locator('.remove-poll').isDisabled(), true);
}

async function checkDemoIsolation(page) {
  const stored = () =>
    page.evaluate(() => localStorage.getItem('poll-intersections.preferences.v1'));
  const view = async () => ({
    groupBy: await page.locator('#groupBy').inputValue(),
    filterBy: await page.locator('#filterBy').inputValue(),
    minimum: await page.locator('#minimumParticipants').inputValue(),
  });
  const liveView = await view();
  const before = await stored();
  const preferencesHint = await page.locator('#preferencesHint').innerText();
  assert.equal(await page.locator('#resultMeta').isVisible(), true);
  assert.match(await page.locator('#resultMeta').innerText(), /loaded at/);
  await page.locator('#demo').click();
  assert.equal(await page.locator('#resultMeta').isVisible(), false);
  assert.equal(await page.locator('#status').isVisible(), false);
  assert.equal(await page.locator('#preferencesHint').innerText(), preferencesHint);
  assert.deepEqual(await view(), { groupBy: 'demo:2', filterBy: 'poll:demo:1', minimum: '3' });
  await page.locator('#groupBy').selectOption('demo:3');
  await page.locator('#filterBy').selectOption('poll:demo:4');
  await page.locator('#minimumParticipants').fill('8');
  assert.equal(await stored(), before);

  await setSettingsExpanded(page, true);
  await page.locator('#link4').fill('https://t.me/groupchat/127');
  const links = await page
    .locator('.poll-link input')
    .evaluateAll((inputs) => inputs.map((input) => input.value));
  const edited = await stored();
  assert.deepEqual(JSON.parse(edited), { ...JSON.parse(before), links });
  await page.locator('#demo').click();
  assert.deepEqual(await view(), { groupBy: 'demo:2', filterBy: 'poll:demo:1', minimum: '3' });
  assert.equal(await stored(), edited);

  await page.locator('#minimumParticipants').fill('6');
  await page.evaluate(() => {
    window.pollRequestError = true;
  });
  await page.locator('#refresh').click();
  await page.waitForFunction(() =>
    document.getElementById('status').textContent.includes('Synthetic request failure'),
  );
  assert.equal(await page.locator('#demoLabel').isVisible(), true);
  assert.equal(await page.locator('#minimumParticipants').inputValue(), '6');
  assert.equal(await stored(), edited);

  await page.evaluate(() => {
    window.pollRequestError = false;
  });
  await page.locator('#refresh').click();
  await page.locator('#demoLabel').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#resultMeta').isVisible(), true);
  assert.match(await page.locator('#resultMeta').innerText(), /loaded at/);
  assert.equal(await page.locator('#preferencesHint').innerText(), preferencesHint);
  assert.deepEqual(await view(), liveView);
  assert.equal(await stored(), edited);
}

async function checkGeneralPolls() {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}/fixture/`);
    assert.equal(await page.locator('#groupBy').isDisabled(), true);
    assert.equal(await page.locator('.view-help').isVisible(), true);
    assert.equal(await page.locator('#filterModes').isVisible(), true);
    await checkRemovalInference(page);
    await page.locator('#connect').click();
    await page.locator('#apiId').fill('12345');
    await page.locator('#apiHash').fill('abcdef0123456789abcdef0123456789');
    await page.locator('#phone').fill('+381123456789');
    await page.locator('#loginSubmit').click();
    await page.locator('#code').fill('12345');
    await page.locator('#loginSubmit').click();
    await page.locator('#login').waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      window.allowPollFetch = true;
    });
    await page.locator('#link0').fill('https://t.me/groupchat/123');
    await page.locator('#refresh').click();
    await page.waitForFunction(
      () => document.getElementById('status').textContent === 'Done. 1 poll loaded.',
    );
    assert.equal(await page.locator('.group-card').count(), 1);
    assert.equal(await page.locator('#viewHelp').isVisible(), true);
    assert.equal(await page.locator('.group-section').count(), 0);
    assert.equal(await page.locator('#groupBy option').count(), 1);
    await downloadCsv(page, 'poll-results.csv');
    await setSettingsExpanded(page, true);
    for (let i = 1; i < 6; i++) await page.locator('#addPoll').click();
    assert.equal(
      await page.locator('#link5').getAttribute('placeholder'),
      'https://t.me/groupchat/128',
    );
    await page.evaluate(() => {
      const options = [{ text: 'Synthetic option', voters: ['1', '2', '3'] }];
      window.pollFixtures = Array.from({ length: 6 }, (_, index) => ({
        title:
          index === 0 || index === 2
            ? '<img src=x>Which tools?'
            : index === 5
              ? ''
              : 'A long question '.repeat(12) + index,
        options,
      }));
      window.pollFixtures[0].options = [
        { text: 'A', voters: ['1', '2'] },
        { text: 'B', voters: ['3'] },
      ];
    });
    await page.locator('#refresh').click();
    await page.waitForFunction(
      () => document.getElementById('status').textContent === 'Done. 6 polls loaded.',
    );
    const ids = await page.evaluate(() => window.lastPollIds);
    assert.equal(await page.locator('#groupBy').inputValue(), ids[0]);
    assert.equal(await page.locator('.group-card').count(), 0);
    await page.locator('#minimumParticipants').fill('2');
    assert.equal(await page.locator('.group-card').count(), 1);
    assert.equal(
      await page.locator('#groupBy option').first().innerText(),
      '<img src=x>Which tools? · 1',
    );
    assert.equal(
      await page.locator('#groupBy option').nth(2).innerText(),
      '<img src=x>Which tools? · 3',
    );
    assert.equal(await page.locator('#groupBy option').last().innerText(), 'Poll 6');
    await page.locator('#groupBy').selectOption(ids[3]);
    assert.equal(await page.locator('#filterBy').inputValue(), 'grouping');
    assert.equal(await page.locator('.group-option').count(), 6);
    await page.locator('#filterBy').selectOption(`poll:${ids[0]}`);
    assert.equal(await page.locator('.group-option').count(), 5);
    assert.equal(await page.locator('.group-count').innerText(), 'Participants: 3');
    const exported = await downloadCsv(page, 'poll-results.csv');
    assert.ok(exported.includes('<img src=x>Which tools? · 1'));
    assert.ok(!exported.includes('username:groupchat'));
    assert.equal(await page.locator('.group-section img').count(), 0);
    await page.locator('#minimumParticipants').fill('4');
    assert.equal(await page.locator('.group-card').count(), 0);
    await page.locator('#filterBy').selectOption('none');
    assert.equal(await page.locator('.group-card').count(), 1);
    assert.equal(await page.locator('#minimumParticipants').isDisabled(), true);
    assert.equal(
      await page.evaluate(() => window.pollFetchCount),
      2,
      'Changing view settings must not reload Telegram',
    );
    await page.locator('#filterBy').selectOption('grouping');
    await page.locator('#minimumParticipants').fill('2');
    await page.locator('#filterBy').selectOption(`poll:${ids[0]}`);
    await page.locator('#refresh').click();
    await page.waitForFunction(() => window.pollFetchCount === 3);
    assert.equal(await page.locator('#groupBy').inputValue(), ids[3]);
    assert.equal(await page.locator('#filterBy').inputValue(), `poll:${ids[0]}`);
    await checkDemoIsolation(page);
    await setSettingsExpanded(page, true);
    await page.locator('#link4').fill('https://t.me/groupchat/127');
    await page.locator('.remove-poll').nth(3).click();
    assert.equal(await page.locator('#link3').inputValue(), 'https://t.me/groupchat/127');
    assert.equal(await page.locator('#link1').inputValue(), '');
    assert.equal(await page.locator('#link2').inputValue(), '');
    assert.equal(await page.locator('#link4').inputValue(), '');
    assert.equal(await page.locator('#export').isDisabled(), true);
    assert.match(await page.locator('#resultMeta').innerText(), /Links changed/);
    await page.locator('#refresh').click();
    await page.waitForFunction(
      () => document.getElementById('status').textContent === 'Done. 5 polls loaded.',
    );
    assert.equal(await page.locator('#groupBy').inputValue(), ids[0]);
    await page.locator('#groupBy').selectOption(ids[5]);
    await page.locator('#filterBy').selectOption(`poll:${ids[5]}`);
    await setSettingsExpanded(page, true);
    await page.locator('.remove-poll').last().click();
    await page.locator('#refresh').click();
    await page.waitForFunction(
      () => document.getElementById('status').textContent === 'Done. 4 polls loaded.',
    );
    assert.equal(await page.locator('#groupBy').inputValue(), ids[0]);
    assert.equal(await page.locator('#filterBy').inputValue(), 'grouping');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.reload();
    assert.equal(await page.locator('.poll-link').count(), 4);
    assert.equal(await page.locator('#viewHelp').isVisible(), false);
    assert.equal(await page.locator('#minimumParticipants').inputValue(), '2');
    await page.evaluate(() =>
      localStorage.setItem(
        'poll-intersections.preferences.v1',
        JSON.stringify({ links: ['https://t.me/groupchat/123', '', '', ''], unusedSetting: 99 }),
      ),
    );
    await page.reload();
    assert.equal(await page.locator('.poll-link').count(), 4);
    assert.equal(await page.locator('#minimumParticipants').inputValue(), '3');
  } finally {
    await context.close();
  }
}

try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
  });
  await checkLazyTelegram();
  await checkGeneralPolls();
  for (const width of [320, 390, 1280])
    for (const colorScheme of ['light', 'dark']) {
      const timeZone = colorScheme === 'light' ? 'UTC' : 'Europe/Belgrade';
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme,
        timezoneId: timeZone,
        hasTouch: width < 650,
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.violations = [];
        document.addEventListener('securitypolicyviolation', (e) =>
          window.violations.push(e.violatedDirective),
        );
      });
      await page.goto(`${origin}/`);
      if (width === 320 && colorScheme === 'light') {
        const wasm = (await readdir('dist/assets')).find((file) => file.endsWith('.wasm'));
        assert.ok(wasm);
        await page.evaluate(async (url) => {
          await WebAssembly.compileStreaming(fetch(url));
        }, `${origin}/assets/${wasm}`);
      }
      await checkTextContrast(page);
      await checkLinkDisclosure(page, width);
      await checkDemo(page, width, timeZone);
      await openQr(page);
      assert.equal(await page.locator('#qrLogin').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#phone').isEnabled(), false);
      assert.equal(await page.locator('#phoneLabel').isVisible(), false);
      assert.equal(await page.locator('#loginSubmit').innerText(), 'Show QR code');
      await page.locator('#cancelLogin').click();
      await page.goto(`${origin}/fixture/`);
      // Isolate auth storage assertions from the poll-link form's preferences.
      await page.evaluate(() => localStorage.clear());
      await openQr(page, true);
      assert.equal(await page.locator('#loginForm').evaluate((form) => form.checkValidity()), true);
      await page.locator('#loginSubmit').click();
      await page.locator('#qrCode').waitFor({ state: 'visible' });
      assert.equal(await decoded(page), 'tg://login?token=SYNTHETIC_FIRST_TOKEN');
      assert.equal(await page.evaluate(() => localStorage.length), 0);
      const box = await page.locator('#qrCode').boundingBox();
      assert.ok(box.width >= 200 && box.x >= 0 && box.x + box.width <= width);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.evaluate(() =>
        window.qrTest.options.onUrlUpdated(
          'tg://login?token=SYNTHETIC_NEXT_TOKEN',
          new Date(Date.now() + 30000),
        ),
      );
      assert.equal(await decoded(page), 'tg://login?token=SYNTHETIC_NEXT_TOKEN');
      await page.evaluate(() =>
        window.qrTest.options.onUrlUpdated(
          'tg://login?token=SYNTHETIC_EXPIRING_TOKEN',
          new Date(Date.now() + 80),
        ),
      );
      await page.locator('#qrCode').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#qrCode').getAttribute('src'), null);
      await page.evaluate(() =>
        window.qrTest.options.onUrlUpdated(
          'tg://login?token=SYNTHETIC_REPLACEMENT_TOKEN',
          new Date(Date.now() + 30000),
        ),
      );
      assert.equal(await decoded(page), 'tg://login?token=SYNTHETIC_REPLACEMENT_TOKEN');
      await page.evaluate(() => window.requirePassword());
      await page.locator('#password').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#qrCode').getAttribute('src'), null);
      assert.equal(await page.locator('#apiHash').inputValue(), '');
      await page.locator('#password').fill('wrong');
      await page.locator('#loginSubmit').click();
      await page.waitForFunction(() =>
        document.getElementById('loginStatus').textContent.includes('Incorrect'),
      );
      await page.locator('#password').fill('correct 2FA');
      await page.locator('#loginSubmit').click();
      await page.locator('#saveFields').waitFor({ state: 'visible' });
      await page.locator('#savePassword').fill('Test1234');
      await page.locator('#saveConfirm').fill('Test1234');
      await page.locator('#loginSubmit').click();
      await page.locator('#login').waitFor({ state: 'hidden' });
      const saved = await page.evaluate(() =>
        localStorage.getItem('poll-intersections.session.v1'),
      );
      assert.ok(
        saved &&
          !saved.includes('SYNTHETIC') &&
          !saved.includes('abcdef0123456789abcdef0123456789'),
      );
      await page.locator('#link0').fill('https://t.me/groupchat/123');
      await page.reload();
      assert.equal(await page.locator('.group-card').count(), 0);
      assert.equal(await page.locator('#pollLinks').isVisible(), false);
      assert.equal(await page.locator('#demo').isVisible(), false);
      assert.equal(await page.locator('#refresh').isVisible(), true);
      assert.equal(await page.evaluate(() => window.pollFetchCount ?? 0), 0);
      await page.evaluate(() => {
        window.allowPollFetch = true;
      });
      await page.locator('#refresh').click();
      await page.locator('#unlockPassword').fill('Test1234');
      await page.locator('#loginSubmit').click();
      await page.locator('#login').waitFor({ state: 'hidden' });
      assert.equal(
        await page.evaluate(() => window.importedSession),
        'SYNTHETIC_SESSION_FOR_BROWSER_TEST',
      );
      await page.waitForFunction(() =>
        document.getElementById('status').textContent.startsWith('Done.'),
      );
      assert.equal(await page.locator('#pollLinks').isVisible(), false);
      assert.equal(await page.locator('.group-card').count(), 1);
      assert.equal(await page.locator('.group-card[open]').count(), 0);
      if ((width === 320 && colorScheme === 'light') || (width === 1280 && colorScheme === 'dark'))
        await checkRefreshDisclosure(page);
      const pollPreferences = await page.evaluate(() =>
        localStorage.getItem('poll-intersections.preferences.v1'),
      );
      await page.locator('#disconnect').click();
      await page.locator('#connect').waitFor({ state: 'visible' });
      assert.equal(
        await page.evaluate(() => localStorage.getItem('poll-intersections.session.v1')),
        null,
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem('poll-intersections.preferences.v1')),
        pollPreferences,
      );
      await openQr(page);
      await page.locator('#loginSubmit').click();
      await page.locator('#qrCode').waitFor({ state: 'visible' });
      await page.locator('#phoneLogin').click();
      assert.equal(await page.evaluate(() => window.qrTest.options.abortSignal.aborted), true);
      assert.equal(await page.locator('#qrCode').getAttribute('src'), null);
      assert.equal(await page.locator('#phone').isEnabled(), true);
      await page.locator('#phone').fill('+381123456789');
      await page.locator('#loginSubmit').click();
      await page.locator('#code').waitFor({ state: 'visible' });
      await page.locator('#cancelLogin').click();
      assert.deepEqual(await page.evaluate(() => window.violations), []);
      cases++;
      await context.close();
    }
  const development = await createServer({ logLevel: 'error', server: { port: 0 } });
  try {
    await development.listen();
    const devOrigin = `http://127.0.0.1:${development.httpServer.address().port}`;
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.violations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        window.violations.push(event.violatedDirective),
      );
    });
    const connected = page.waitForEvent('console', {
      predicate: (message) => message.text().includes('[vite] connected.'),
    });
    await page.goto(devOrigin);
    await connected;
    await page.locator('#demo').click();
    assert.equal(await page.locator('.group-card').count(), 10);
    await page.evaluate(async () => {
      const { makeCrypto } = await import('/infrastructure/telegram/client.ts');
      const crypto = makeCrypto();
      await crypto.initialize();
      if (crypto.sha256(new TextEncoder().encode('WASM smoke check')).length !== 32)
        throw new Error('Invalid WASM result');
    });
    assert.deepEqual(await page.evaluate(() => window.violations), []);
    await page.evaluate(() => {
      window.reloadProbe = true;
    });
    const reloaded = page.waitForEvent('load');
    development.ws.send({ type: 'full-reload' });
    await reloaded;
    assert.equal(await page.evaluate(() => window.reloadProbe), undefined);
    assert.deepEqual(await page.evaluate(() => window.violations), []);
    await page.close();
  } finally {
    await development.close();
  }
  assert.equal(
    (await stat('dist/index.html')).mtimeMs,
    buildMtime,
    'Preview and development must not rebuild dist',
  );
  assert.deepEqual(errors, []);
  console.log(
    `Browser: ${cases} viewport/theme cases passed; load button placement, settings and result disclosures, lazy SDK loading, load failure recovery, cancellation, demo, CSV downloads, vote tooltips, time zones, keyboard/touch/hover, QR, 2FA, loading after encrypted reload and CSP verified.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
