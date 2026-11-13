import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { decodeQR } from 'qr/decode.js';
import assert from 'node:assert/strict';

// Use the real UI, QR encoder and encryption, replacing only Telegram's network.
// The HTTP server serves two in-memory pages and never exposes workspace files.
const fixture = await build({
  entryPoints:['src/main.mjs'], bundle:true, write:false, platform:'browser', format:'iife',
  plugins:[{name:'fake-telegram', setup(builder) {
    builder.onLoad({filter:/\/telegram\.mjs$/}, () => ({loader:'js', contents:`
      export const createClient = (id, hash) => ({
        async getApiCredentials() { return {id, hash}; },
        async exportSession() { return 'SYNTHETIC_SESSION_FOR_BROWSER_TEST'; },
        async importSession(session) { window.importedSession = session; },
        async destroy() { window.destroyed = (window.destroyed || 0) + 1; },
      });
      export const auth = {
        sendCode: async () => ({phoneCodeHash:'fake-code-hash', type:'app'}),
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
      };
      export const explainError = error => error.message;
      export const fetchPolls = () => {
        if (!window.allowPollFetch) throw new Error('Unexpected poll request');
        if (window.pollRequestError) throw new Error('Synthetic request failure');
        return {names:{'1':'First', '2':'Second', '3':'Third'}, polls:Array.from({length:4}, () => ({options:[{text:'Synthetic option', voters:['1','2','3']}]}))};
      };
    `}));
  }}],
});
const script = fixture.outputFiles[0].text;
const hash = createHash('sha256').update(script).digest('base64');
const styles = await readFile('src/styles.css','utf8');
const html = (await readFile('src/index.html','utf8'))
  .replace('__APP_SCRIPT__', () => script).replace('__SCRIPT_HASH__', hash)
  .replace('__APP_STYLE__', () => styles);
const production = await readFile('dist/index.html','utf8');
const server = createServer((request, response) => {
  const content = request.url === '/dist/' ? production : request.url === '/fixture/' ? html : null;
  response.writeHead(content === null ? 404 : 200, {'Content-Type':'text/html; charset=utf-8'});
  response.end(content ?? 'Not found');
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
let cases = 0;
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
  await page.waitForFunction(() => { const img = document.getElementById('qrCode'); return img.complete && img.naturalWidth > 0; });
  const image = await page.locator('#qrCode').evaluate(img => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0);
    return {width:canvas.width, height:canvas.height, data:Array.from(ctx.getImageData(0,0,canvas.width,canvas.height).data)};
  });
  return decodeQR({...image, data:Uint8Array.from(image.data)});
}
async function checkLinkDisclosure(page, width) {
  const details = page.locator('#pollLinks');
  const toggle = page.locator('#pollLinksToggle');
  assert.equal(await details.evaluate(node => node.open), true);
  await page.locator('#link0').fill('https://t.me/groupchat/123');
  assert.equal(await details.evaluate(node => node.open), true);
  await toggle.click();
  assert.equal(await page.locator('#link0').isVisible(), false);
  assert.equal(await page.locator('.links-edit').isVisible(), true);
  assert.equal(await page.locator('#pollLinksCount').innerText(), ' · 4 polls');
  assert.equal(await page.locator('#refresh').isVisible(), true);
  assert.equal(await page.locator('#demo').isVisible(), true);
  const box = await toggle.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= width);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#link0').isVisible(), true);
  await page.reload();
  assert.equal(await details.evaluate(node => node.open), false);
  await toggle.click();
  if (width === 320) {
    await page.locator('#link0').fill('bad');
    await toggle.click();
    await page.locator('#refresh').click();
    assert.equal(await details.evaluate(node => node.open), true);
    assert.equal(await page.locator('#link0').evaluate(node => node === document.activeElement), true);
    await page.locator('#link0').fill('https://example.com/nope');
    await toggle.click();
    await page.locator('#refresh').click();
    assert.equal(await details.evaluate(node => node.open), true);
    assert.equal(await page.locator('#link0').evaluate(node => node === document.activeElement), true);
    await page.locator('#link0').fill('https://t.me/groupchat/123');
    await page.locator('#link1').fill('https://t.me/groupchat/123');
    await toggle.click();
    assert.equal(await page.locator('#clearLinks').isVisible(), false);
    await page.locator('#refresh').click();
    assert.equal(await details.evaluate(node => node.open), true);
    assert.equal(await page.locator('#link1').evaluate(node => node === document.activeElement), true);
    assert.equal(await page.locator('#login').isVisible(), false);
    await page.locator('#clearLinks').click();
  } else {
    await page.locator('#link0').fill('');
  }
  await page.reload();
  assert.equal(await details.evaluate(node => node.open), true);
  assert.equal(await page.locator('#link0').inputValue(), '');
}
async function checkRefreshCollapse(page) {
  await page.locator('#link0').fill('https://t.me/groupchat/123');
  await page.evaluate(() => { window.allowPollFetch = true; });
  await page.locator('#link0').press('Enter');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Done.'));
  assert.equal(await page.locator('#pollLinks').evaluate(node => node.open), false);
  assert.equal(await page.locator('#refresh').isVisible(), true);
  await page.evaluate(() => { window.pollRequestError = true; });
  for (const open of [true, false]) {
    await page.locator('#pollLinksToggle').click();
    await page.locator('#refresh').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('Synthetic request failure'));
    assert.equal(await page.locator('#pollLinks').evaluate(node => node.open), open);
  }
  await page.locator('#pollLinksToggle').click();
  await page.locator('#link1').fill('https://t.me/groupchat/124');
  await page.locator('#clearLinks').click();
  assert.equal(await page.locator('#pollLinks').evaluate(node => node.open), true);
  await page.evaluate(() => localStorage.removeItem('poll-intersections.preferences.v1'));
}
async function checkDemo(page, width, timeZone) {
  await page.locator('#demo').click();
  assert.equal(await page.locator('.date-card').count(), 10);
  await page.locator('#topicMinimum').fill('0');
  assert.equal(await page.locator('.date-option').count(), 160);
  const card = page.locator('.date-card').first();
  const attendees = card.locator('.date-attendees');
  const anna = attendees.getByRole('button', {name:'Anna Maria Silva', exact:true});
  const tooltip = page.locator('#personTooltip');
  await anna.focus();
  await tooltip.waitFor({state:'visible'});
  const expected = timeZone === 'UTC'
    ? 'Topic — no vote\nDate — 12 Nov, 14:51\nTime — 12 Nov, 20:51\nPlace — 13 Nov, 02:51\nTelegram ID: 3'
    : 'Topic — no vote\nDate — 12 Nov, 15:51\nTime — 12 Nov, 21:51\nPlace — 13 Nov, 03:51\nTelegram ID: 3';
  assert.equal(await tooltip.innerText(), expected);
  assert.equal(await anna.getAttribute('class'), 'person');
  assert.equal(await anna.getAttribute('aria-describedby'), 'personTooltip');
  const bounds = await tooltip.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 900);
  await page.keyboard.press('Escape');
  assert.equal(await tooltip.isVisible(), false);
  assert.equal(await anna.getAttribute('aria-describedby'), null);
  await page.locator('#demo').focus();
  await anna.hover();
  await tooltip.hover();
  await page.waitForTimeout(250);
  assert.equal(await tooltip.isVisible(), true);
  await page.mouse.move(0,0);
  await tooltip.waitFor({state:'hidden'});

  const books = card.locator('.date-option').filter({has:page.locator('.option-name', {hasText:/^Books$/})});
  const topicAnna = books.getByRole('button', {name:'Anna Maria Silva', exact:true});
  if (width < 650) await topicAnna.tap(); else await topicAnna.click();
  assert.equal(await topicAnna.getAttribute('class'), 'person implicit');
  assert.equal(await tooltip.innerText(), expected);
  await page.keyboard.press('Escape');

  await attendees.getByRole('button', {name:'Alex', exact:true}).focus();
  await tooltip.waitFor({state:'visible'});
  assert.equal((await tooltip.innerText()).split('\n').length, 5);
  assert.ok(!(await tooltip.innerText()).includes('no vote'));
  await page.keyboard.press('Escape');
  await attendees.getByRole('button', {name:'Jamie de Vries', exact:true}).focus();
  await tooltip.waitFor({state:'visible'});
  assert.ok((await tooltip.innerText()).startsWith('Date — no vote\nTime — no vote\nPlace — no vote\nTopic — '));
  await page.keyboard.press('Escape');
  await page.locator('.date-attendees').getByRole('button', {name:'Noor Ali Hassan', exact:true}).first().focus();
  await tooltip.waitFor({state:'visible'});
  assert.ok((await tooltip.innerText()).startsWith('Time — no vote\nPlace — no vote\nTopic — time unavailable\nDate — '));
  await page.keyboard.press('Escape');
  await card.locator('.date-count').click();
  assert.equal(await tooltip.innerText(), '3 people have no vote in Date.\nTotal: 8');
  await page.keyboard.press('Escape');
  await card.locator('.best-topic-count').click();
  assert.equal(await tooltip.innerText(), 'Largest topic group for this date.\n5 people have no vote in Date or Topic.\nTotal: 7');
  await page.keyboard.press('Escape');
  await books.locator('.option-count').click();
  assert.equal(await tooltip.innerText(), '5 people have no vote in Date or Topic.\nTotal: 7');
  await page.keyboard.press('Escape');
  await page.locator('#topicMinimum').fill('11');
  assert.equal(await page.locator('.date-card').count(), 0);
  assert.equal(await page.locator('#export').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ['poll-intersections.preferences.v1']);
}
try {
  browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, headless:true});
  for (const width of [320,390,1280]) for (const colorScheme of ['light','dark']) {
    const timeZone = colorScheme === 'light' ? 'UTC' : 'Europe/Belgrade';
    const context = await browser.newContext({viewport:{width,height:900}, colorScheme, timezoneId:timeZone, hasTouch:width < 650});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.violations=[]; document.addEventListener('securitypolicyviolation', e => window.violations.push(e.violatedDirective)); });
    await page.goto(`${origin}/dist/`);
    await checkLinkDisclosure(page, width);
    await checkDemo(page, width, timeZone);
    await openQr(page);
    assert.equal(await page.locator('#qrLogin').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#phone').isEnabled(), false);
    assert.equal(await page.locator('#phoneLabel').isVisible(), false);
    assert.equal(await page.locator('#loginSubmit').innerText(), 'Show QR code');
    await page.locator('#cancelLogin').click();
    await page.goto(`${origin}/fixture/`);
    // Isolate auth storage assertions from the demo's persisted topic filter.
    await page.evaluate(() => localStorage.clear());
    await openQr(page, true);
    assert.equal(await page.locator('#loginForm').evaluate(form => form.checkValidity()), true);
    await page.locator('#loginSubmit').click();
    await page.locator('#qrCode').waitFor({state:'visible'});
    assert.equal(await decoded(page), 'tg://login?token=SYNTHETIC_FIRST_TOKEN');
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    const box = await page.locator('#qrCode').boundingBox();
    assert.ok(box.width >= 200 && box.x >= 0 && box.x + box.width <= width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => window.qrTest.options.onUrlUpdated('tg://login?token=SYNTHETIC_NEXT_TOKEN',new Date(Date.now()+30000)));
    assert.equal(await decoded(page), 'tg://login?token=SYNTHETIC_NEXT_TOKEN');
    await page.evaluate(() => window.qrTest.options.onUrlUpdated('tg://login?token=SYNTHETIC_EXPIRING_TOKEN',new Date(Date.now()+80)));
    await page.locator('#qrCode').waitFor({state:'hidden'});
    assert.equal(await page.locator('#qrCode').getAttribute('src'), null);
    await page.evaluate(() => window.qrTest.options.onUrlUpdated('tg://login?token=SYNTHETIC_REPLACEMENT_TOKEN',new Date(Date.now()+30000)));
    assert.equal(await decoded(page), 'tg://login?token=SYNTHETIC_REPLACEMENT_TOKEN');
    await page.evaluate(() => window.qrTest.reject(new Error('SESSION_PASSWORD_NEEDED')));
    await page.locator('#password').waitFor({state:'visible'});
    assert.equal(await page.locator('#qrCode').getAttribute('src'), null);
    assert.equal(await page.locator('#apiHash').inputValue(), '');
    await page.locator('#password').fill('wrong');
    await page.locator('#loginSubmit').click();
    await page.waitForFunction(() => document.getElementById('loginStatus').textContent.includes('Incorrect'));
    await page.locator('#password').fill('correct 2FA');
    await page.locator('#loginSubmit').click();
    await page.locator('#saveFields').waitFor({state:'visible'});
    await page.locator('#savePassword').fill('Test1234');
    await page.locator('#saveConfirm').fill('Test1234');
    await page.locator('#loginSubmit').click();
    await page.locator('#login').waitFor({state:'hidden'});
    const saved = await page.evaluate(() => localStorage.getItem('poll-intersections.session.v1'));
    assert.ok(saved && !saved.includes('SYNTHETIC') && !saved.includes('abcdef0123456789abcdef0123456789'));
    await page.reload();
    await page.locator('#connect').click();
    await page.locator('#unlockPassword').fill('Test1234');
    await page.locator('#loginSubmit').click();
    await page.locator('#login').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => window.importedSession), 'SYNTHETIC_SESSION_FOR_BROWSER_TEST');
    if (width === 320 && colorScheme === 'light' || width === 1280 && colorScheme === 'dark') await checkRefreshCollapse(page);
    await page.locator('#disconnect').click();
    await page.locator('#connect').waitFor({state:'visible'});
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    await openQr(page);
    await page.locator('#loginSubmit').click();
    await page.locator('#qrCode').waitFor({state:'visible'});
    await page.locator('#phoneLogin').click();
    assert.equal(await page.evaluate(() => window.qrTest.options.abortSignal.aborted), true);
    assert.equal(await page.locator('#qrCode').getAttribute('src'), null);
    assert.equal(await page.locator('#phone').isEnabled(), true);
    await page.locator('#phone').fill('+381123456789');
    await page.locator('#loginSubmit').click();
    await page.locator('#code').waitFor({state:'visible'});
    await page.locator('#cancelLogin').click();
    assert.deepEqual(await page.evaluate(() => window.violations), []);
    cases++;
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Browser: ${cases} viewport/theme cases passed; demo, vote tooltips, time zones, keyboard/touch/hover, QR, 2FA, encrypted reload, cancellation and CSP verified.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
