import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import ts from 'typescript';
import { ESLint } from 'eslint';

const sourceRoot = resolve('src');
const allowed = {
  domain: ['domain'],
  application: ['application', 'domain'],
  presentation: ['presentation', 'domain', 'application'],
  infrastructure: ['infrastructure', 'domain', 'application'],
  api: ['domain', 'application'],
  'main.ts': ['domain', 'application', 'presentation', 'infrastructure', 'api'],
};
const composition = new Set(['main.ts', 'presentation/app.ts']);
const { dependencies } = JSON.parse(await readFile('package.json', 'utf8'));

function location(name) {
  const parts = name.split(sep).join('/').split('/');
  const owner = parts[0] === 'modules' ? parts[1] : null;
  const layer = owner
    ? parts[2] === 'index.ts' && parts.length === 3
      ? 'api'
      : parts[2]
    : parts[0];
  assert.ok(Object.hasOwn(allowed, layer), `${name} must belong to an architectural layer`);
  return { layer, owner };
}

function checkSource(name, source) {
  const { layer, owner } = location(name);
  const file = resolve(sourceRoot, name);
  const imports = [];
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const require = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (dynamicImport || require)
        assert.ok(
          node.arguments.length && ts.isStringLiteralLike(node.arguments[0]),
          `${name} must use a literal module specifier`,
        );
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  for (const { fileName: specifier } of ts.preProcessFile(source, true, true).importedFiles) {
    if (specifier.startsWith('.')) {
      const path = relative(sourceRoot, resolve(dirname(file), specifier))
        .split(sep)
        .join('/');
      const dependency = location(path);
      const dependencyLayer = dependency.layer === 'api' ? 'application' : dependency.layer;
      assert.ok(allowed[layer].includes(dependencyLayer), `${name} must not import ${specifier}`);
      if (dependency.owner && dependency.owner !== owner && !composition.has(name)) {
        assert.ok(owner, `Shared code in ${name} must not depend on a feature`);
        assert.equal(
          dependency.layer,
          'api',
          `${name} must use the public API of ${dependency.owner}`,
        );
      }
      if (layer === 'api')
        assert.equal(owner, dependency.owner, `${name} must expose its own module's core`);
      imports.push(dependency);
    } else {
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      assert.ok(
        (layer === 'infrastructure' && Object.hasOwn(dependencies, packageName)) ||
          (layer === 'presentation' && packageName === 'qr'),
        `${name} must not import ${specifier}`,
      );
    }
  }
  return imports;
}

function checkCycles(graph) {
  const visiting = new Set();
  const visited = new Set();
  function visit(module) {
    assert.ok(!visiting.has(module), `Module dependency cycle at ${module}`);
    if (visited.has(module)) return;
    visiting.add(module);
    for (const dependency of graph.get(module) ?? []) visit(dependency);
    visiting.delete(module);
    visited.add(module);
  }
  for (const module of graph.keys()) visit(module);
}

test('every source module preserves layer boundaries, feature APIs and acyclic module dependencies', async () => {
  const graph = new Map();
  for (const name of await readdir('src', { recursive: true })) {
    if (!name.endsWith('.ts')) continue;
    const { owner } = location(name);
    const imports = checkSource(name, await readFile(resolve(sourceRoot, name), 'utf8'));
    if (owner) {
      if (!graph.has(owner)) graph.set(owner, new Set());
      for (const dependency of imports)
        if (dependency.owner && dependency.owner !== owner) graph.get(owner).add(dependency.owner);
    }
  }
  checkCycles(graph);
});

test('boundary checks cover re-exports, type imports, dynamic imports and modules outside the layers', () => {
  for (const source of [
    "import '../infrastructure/telegram/client.ts';",
    "export * from '../presentation/csv.ts';",
    "export { csv } from '../presentation/csv.ts';",
    "type Client = import('../infrastructure/telegram/client.ts').Client;",
    "void import('../infrastructure/telegram/client.ts');",
    "const adapter = require('../infrastructure/telegram/client.ts');",
    'void import(moduleName);',
    "import { x } from '../main.ts';",
    "import { x } from '../../test/fixtures/app.mjs';",
    "import { x } from '@mtcute/web';",
  ])
    assert.throws(() => checkSource('application/probe.ts', source));
  assert.throws(() => checkSource('unowned.ts', 'export {};'));
  assert.throws(() => checkSource('presentation/probe.ts', "import '@mtcute/web/methods.js';"));
  checkSource('application/probe.ts', "import type { Poll } from '../domain/models.ts';");
  checkSource('modules/auth/presentation/probe.ts', "import encodeQR from 'qr';");
  checkSource('main.ts', "import { startApp } from './presentation/app.ts';");
  for (const source of [
    "import '../../polls/application/results.ts';",
    "export * from '../../polls/domain/polls.ts';",
    "type Result = import('../../polls/application/results.ts').PollResult;",
    "void import('../../polls/infrastructure/telegram.ts');",
    "import '../presentation/auth.ts';",
  ])
    assert.throws(() => checkSource('modules/auth/application/probe.ts', source));
  assert.throws(() =>
    checkSource('modules/auth/domain/probe.ts', "import '../../polls/index.ts';"),
  );
  assert.throws(() =>
    checkSource('modules/auth/index.ts', "export * from './infrastructure/saved-session.ts';"),
  );
  assert.throws(() => checkSource('infrastructure/probe.ts', "import '../modules/auth/index.ts';"));
  checkSource(
    'modules/auth/application/probe.ts',
    "import type { PollResults } from '../../polls/index.ts';",
  );
  checkSource('presentation/app.ts', "import '../modules/auth/presentation/auth.ts';");
  checkCycles(new Map([['auth', new Set(['polls'])]]));
  assert.throws(() =>
    checkCycles(
      new Map([
        ['auth', new Set(['polls'])],
        ['polls', new Set(['auth'])],
      ]),
    ),
  );
});

test('core lint rules reject direct browser I/O and access through globalThis', async () => {
  const eslint = new ESLint();
  for (const file of [
    'domain/errors.ts',
    'application/errors.ts',
    'modules/polls/domain/models.ts',
    'modules/auth/application/contracts.ts',
  ]) {
    const [result] = await eslint.lintText(
      "export const read = () => localStorage.getItem('key');\nexport const load = () => globalThis.fetch('https://example.com');",
      { filePath: resolve(sourceRoot, file) },
    );
    assert.equal(
      result.messages.filter((message) => message.ruleId === 'no-restricted-globals').length,
      2,
    );
  }
});
