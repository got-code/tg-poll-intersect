import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPollResults,
  matchesSourceLinks,
  selectResultGroups,
  resolveViewSettings,
} from '../src/modules/polls/application/results.ts';
import { linkIdentity, parseLink, readPollLinks } from '../src/modules/polls/application/links.ts';
import { UserFacingError } from '../src/application/errors.ts';
import { samplePolls } from './fixtures/polls.mjs';

const links = readPollLinks(['https://t.me/groupchat/123', '', '', '']);
const identities = links.map(linkIdentity);
const settings = { groupBy: 'poll:2', filterBy: 'grouping', minimumParticipants: 0 };

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
    selectResultGroups(result, settings).map((group) => group.option),
    ['14 November', '15 November'],
  );
  assert.deepEqual(selectResultGroups(result, settings)[0].sections[0].options[0].ids, [
    '1',
    '2',
    '4',
  ]);
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
  assert.deepEqual(result.viewSettings, {
    groupBy: result.polls[1].id,
    filterBy: { pollId: result.polls[0].id },
    minimumParticipants: 3,
  });
  const before = structuredClone(result);
  assert.equal(result.kind, 'demo');
  assert.deepEqual(result.sourceLinks, []);
  assert.equal(matchesSourceLinks(result, []), true);
  await assert.rejects(
    results.load(links, () => {}),
    (error) => error === failure,
  );
  assert.deepEqual(result, before);
  assert.notEqual(results.demo().polls, result.polls);
});

test('view defaults follow grouping, preserve identities across reordering and recover removed choices', () => {
  const { polls } = samplePolls();
  const defaults = { groupBy: null, filterBy: 'grouping', minimumParticipants: 3 };
  assert.equal(resolveViewSettings(polls, defaults).groupBy, polls[0].id);
  const selected = { ...defaults, groupBy: polls[2].id, filterBy: { pollId: polls[3].id } };
  assert.deepEqual(resolveViewSettings(polls.toReversed(), selected), selected);
  const remaining = polls.slice(0, 2);
  assert.deepEqual(resolveViewSettings(remaining, selected), { ...defaults, groupBy: polls[0].id });
  const result = { polls, names: {}, kind: 'demo', sourceLinks: [], updatedAt: new Date() };
  const before = structuredClone(result);
  assert.equal(selectResultGroups(result, { ...defaults, minimumParticipants: 4 }).length, 1);
  assert.equal(
    selectResultGroups(result, { ...defaults, filterBy: 'none', minimumParticipants: 100 }).length,
    2,
  );
  assert.equal(
    selectResultGroups(result, { ...defaults, groupBy: polls[1].id, minimumParticipants: 4 })
      .length,
    2,
  );
  assert.deepEqual(result, before);
});

test('load accepts one, two and more than four polls and rejects partial source snapshots', async () => {
  for (const count of [1, 2, 6]) {
    const requested = readPollLinks(['https://t.me/groupchat/123', ...Array(count - 1).fill('')]);
    const polls = requested.map((link) => ({
      id: linkIdentity(link),
      title: 'Same question',
      options: [{ text: 'Answer', voters: ['1'] }],
    }));
    const workflow = createPollResults({
      source: { load: async () => ({ polls, names: { 1: 'Alex' } }) },
      demo: samplePolls,
    });
    const loaded = await workflow.load(requested, () => {});
    assert.equal(loaded.polls.length, count);
    assert.equal(
      selectResultGroups(loaded, { groupBy: null, filterBy: 'grouping', minimumParticipants: 1 })[0]
        .sections.length,
      count - 1,
    );
    polls.pop();
    await assert.rejects(workflow.load(requested, () => {}));
  }
});
