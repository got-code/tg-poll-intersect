import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportResults, canExportResults } from '../src/modules/polls/application/export.ts';
import { groupByDate } from '../src/modules/polls/domain/polls.ts';
import { readPollLinks, linkIdentity } from '../src/modules/polls/application/links.ts';
import { samplePolls } from './fixtures/polls.mjs';

const identities = readPollLinks(['https://t.me/groupchat/123', '', '', '']).map(linkIdentity);
function result(data = samplePolls(), kind = 'live') {
  return {
    groups: groupByDate(data.polls),
    names: data.names,
    kind,
    sourceLinks: kind === 'live' ? identities : [],
    updatedAt: new Date(0),
  };
}

test('export preparation projects names and counts, excluding IDs and vote metadata before serialization', () => {
  const explicit = 'user:987654321012';
  const implicit = 'peerChannel:876543210123';
  const data = {
    names: { [explicit]: 'Anna' },
    polls: [
      { options: [{ text: 'Topic', voters: [explicit] }] },
      { options: [{ text: 'Date', voters: [explicit, implicit] }] },
      { options: [{ text: 'Time', voters: [implicit] }] },
      { options: [{ text: 'Place', voters: [explicit, implicit] }] },
    ],
  };
  const current = result(data);
  const before = structuredClone(current);
  const rows = exportResults(current, identities, 2);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1], {
    date: 'Date',
    section: 'topic',
    option: 'Topic',
    total: 2,
    explicit: 1,
    implicit: 1,
    participants: ['Anna', 'Unnamed participant'],
    implicitParticipants: ['Unnamed participant'],
  });
  assert.deepEqual(rows[0].participants, ['Anna', 'Unnamed participant']);
  assert.equal(rows[0].explicit, 2);
  assert.equal(rows[0].implicit, 0);
  assert.deepEqual(rows[2].implicitParticipants, ['Anna']);
  assert.equal(rows[3].explicit, 2);
  const serialized = JSON.stringify(rows);
  for (const privateValue of [
    explicit,
    implicit,
    '987654321012',
    '876543210123',
    'votesByPerson',
    'sourceLinks',
  ])
    assert.ok(!serialized.includes(privateValue));
  assert.deepEqual(current, before);
});

test('export uses the topic minimum while keeping day counts and all time and place options', () => {
  const current = result();
  const rows = exportResults(current, identities, 3);
  assert.deepEqual(
    rows.filter((row) => row.section === 'topic').map((row) => row.option),
    ['Books', 'AI'],
  );
  assert.deepEqual(
    rows.filter((row) => row.section === 'date').map((row) => row.total),
    [4, 4],
  );
  assert.equal(rows.filter((row) => row.section === 'time').length, 4);
  assert.equal(rows.filter((row) => row.section === 'place').length, 4);
  assert.equal(
    exportResults(current, identities, 0).filter((row) => row.section === 'topic').length,
    4,
  );
});

test('the application rejects stale or empty exports even when invoked without the UI', () => {
  const current = result();
  for (const changed of [
    [],
    identities.slice(0, 3),
    identities.toReversed(),
    [...identities, 'extra'],
  ]) {
    assert.equal(canExportResults(current, changed, 0), false);
    assert.throws(() => exportResults(current, changed, 0), /Links changed/);
  }
  assert.equal(canExportResults(current, identities, 4), false);
  assert.throws(() => exportResults(current, identities, 4), /No results/);
  assert.equal(canExportResults(current, identities, 3), true);
  const demo = result(samplePolls(), 'demo');
  assert.equal(canExportResults(demo, [], 3), true);
  assert.deepEqual(exportResults(demo, [], 3), exportResults(current, identities, 3));
});
