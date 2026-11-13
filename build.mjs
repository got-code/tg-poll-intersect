import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const wasmPath = require.resolve('@mtcute/wasm/mtcute.wasm', { paths: [require.resolve('@mtcute/web')] });
const wasm = await readFile(wasmPath);
const result = await build({
  entryPoints: ['src/main.mjs'], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: ['chrome100', 'firefox100'],
  minify: true, legalComments: 'eof', metafile: true,
  define: { 'import.meta.url': '""' },
});
const script = result.outputFiles[0].text.replace('__WASM_BASE64__', wasm.toString('base64')).replace(/<\/script/gi, '<\\/script');
const hash = createHash('sha256').update(script).digest('base64');
const template = await readFile('src/index.html', 'utf8');
const styles = await readFile('src/styles.css', 'utf8');
const notices = await licenses();
const html = template.replace('__SCRIPT_HASH__', hash).replace('__APP_STYLE__', () => styles).replace('__APP_SCRIPT__', () => script)
  .replace('</body>', () => `<!--\n${notices.replaceAll('--', '—')}\n-->\n</body>`);
if (html.includes('__WASM_BASE64__')) throw new Error('WASM was not embedded');
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', html);
await writeFile('dist/.nojekyll', '');
await writeFile('dist/THIRD-PARTY-LICENSES.txt', notices);
console.log(`Built dist/index.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB, no external scripts/assets)`);

async function licenses() {
  const entries = Object.keys(result.metafile.inputs).filter(path => /node_modules/.test(path));
  const dirs = new Set(entries.map(path => {
    const marker = path.lastIndexOf('/node_modules/');
    const root = marker < 0 ? 'node_modules/' : path.slice(0, marker + 14);
    const name = path.slice(root.length).split('/');
    return root + name.slice(0, name[0].startsWith('@') ? 2 : 1).join('/');
  }));
  dirs.add(wasmPath.slice(0, wasmPath.lastIndexOf('/')));
  let text = 'Third-party components bundled in index.html\n\n';
  const seen = new Set();
  for (const dir of [...dirs].sort()) {
    const info = JSON.parse(await readFile(`${dir}/package.json`, 'utf8'));
    if (seen.has(info.name)) continue;
    seen.add(info.name);
    let license = '';
    for (const name of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license']) {
      try { license = await readFile(`${dir}/${name}`, 'utf8'); break; } catch {}
    }
    text += `=== ${info.name}@${info.version} (${info.license}) ===\n${license}\n\n`;
  }
  return text;
}
