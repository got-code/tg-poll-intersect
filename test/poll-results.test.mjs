import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPollResults, matchesSourceLinks } from '../src/modules/polls/application/results.ts';
import { linkIdentity, parseLink, readPollLinks } from '../src/modules/polls/application/links.ts';
import { UserFacingError } from '../src/application/errors.ts';
import { samplePolls } from './fixtures/polls.mjs';

const links = readPollLinks(['https://t.me/groupchat/123', '', '', '']);
const identities = links.map(linkIdentity);

test('the load workflow validates links, forwards structured progress and calculates results without browser or SDK dependencies', async () => {
  const data = samplePolls();
  const before = structuredClone(data);
  const events = [];
  const requests = [];
  const results = createPollResults({
    source: {
      async load(links, progress) {
        requests.push(links);
        progress({ kind: 'loading', index: 1, total: 4 });
        progress({ kind: 'checking' });
        return data;
      },
    },
    demo: samplePolls,
  });
  const result = await results.load(links, (event) => events.push(event));
  assert.deepEqual(requests, [links]);
  assert.deepEqual(events, [{ kind: 'loading', index: 1, total: 4 }, { kind: 'checking' }]);
  assert.equal(result.kind, 'live');
  assert.ok(result.updatedAt instanceof Date);
  assert.deepEqual(result.sourceLinks, identities);
  assert.deepEqual(
    result.groups.map((group) => group.date),
    ['14 November', '15 November'],
  );
  assert.deepEqual(result.groups[0].sections[0].options[0].ids, ['1', '2', '4']);
  assert.deepEqual(data, before);
  assert.equal(
    matchesSourceLinks(
      result,
      links.map((link) => linkIdentity(parseLink(link.url.replace('t.me', 'telegram.me')))),
    ),
    true,
  );
  assert.equal(matchesSourceLinks(result, identities.slice(1)), false);
  assert.equal(matchesSourceLinks(result, [...identities, 'extra']), false);
  assert.equal(matchesSourceLinks(result, identities.toReversed()), false);
});

test('invalid, duplicate and incomplete links fail before the source is called', async () => {
  let requests = 0;
  const results = createPollResults({
    source: {
      async load() {
        requests++;
        return samplePolls();
      },
    },
    demo: samplePolls,
  });
  for (const invalid of [
    [],
    links.slice(0, 3),
    [links[0], links[0], links[2], links[3]],
    [{ ...links[0], url: 'https://example.com/groupchat/123' }, ...links.slice(1)],
  ])
    await assert.rejects(
      results.load(invalid, () => {}),
      UserFacingError,
    );
  assert.equal(requests, 0);
});

test('demo results need no live source, and a failed load leaves an earlier snapshot usable', async () => {
  const failure = new UserFacingError('The poll changed.');
  const results = createPollResults({
    source: {
      async load() {
        throw failure;
      },
    },
    demo: samplePolls,
  });
  const result = results.demo();
  const before = structuredClone(result);
  assert.equal(result.kind, 'demo');
  assert.deepEqual(result.sourceLinks, []);
  assert.equal(matchesSourceLinks(result, []), true);
  await assert.rejects(
    results.load(links, () => {}),
    (error) => error === failure,
  );
  assert.deepEqual(result, before);
  assert.notEqual(results.demo().groups, result.groups);
});
