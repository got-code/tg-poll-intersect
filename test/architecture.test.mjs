import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';

test('source imports preserve the domain, application, UI and adapter boundaries', async () => {
  const allowed = {
    domain: ['domain'],
    application: ['application', 'domain'],
    ui: ['ui', 'domain', 'application', 'demo.ts'],
    infrastructure: ['infrastructure', 'domain', 'application'],
  };
  for (const name of await readdir('src', { recursive: true })) {
    if (!name.endsWith('.ts')) continue;
    const layer = name.split(sep)[0];
    if (!allowed[layer]) continue; // main.ts is the composition root.
    const file = resolve('src', name);
    const source = await readFile(file, 'utf8');
    for (const [, specifier] of source.matchAll(/^import\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm)) {
      if (specifier.startsWith('.')) {
        const dependency = relative(resolve('src'), resolve(dirname(file), specifier)).split(
          sep,
        )[0];
        assert.ok(allowed[layer].includes(dependency), `${name} must not import ${specifier}`);
      } else {
        assert.ok(
          layer === 'infrastructure' || (layer === 'ui' && !specifier.startsWith('@mtcute/')),
          `${name} must not import ${specifier}`,
        );
      }
    }
  }
});
