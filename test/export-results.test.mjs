import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportResults, canExportResults } from '../src/modules/polls/application/export.ts';
import { readPollLinks, linkIdentity } from '../src/modules/polls/application/links.ts';
import { samplePolls, identifyPolls } from './fixtures/polls.mjs';

const settings = (minimumParticipants) => ({
  groupBy: 'poll:2',
  filterBy: { pollId: 'poll:1' },
  minimumParticipants,
});
const identities = readPollLinks(['https://t.me/groupchat/123', '', '', '']).map(linkIdentity);
function result(data = samplePolls(), kind = 'live') {
  return {
    polls: identifyPolls(data.polls),
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
  const dataExport = exportResults(current, identities, settings(2));
  const rows = dataExport.rows;
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1], {
    groupPoll: 1,
    groupOption: 'Date',
    poll: 0,
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
  const serialized = JSON.stringify(dataExport);
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

test('export filters the selected poll while preserving group counts and other sections', () => {
  const current = result();
  const rows = exportResults(current, identities, settings(3)).rows;
  assert.deepEqual(
    rows.filter((row) => row.poll === 0).map((row) => row.option),
    ['Books', 'AI'],
  );
  assert.deepEqual(
    rows.filter((row) => row.poll === 1).map((row) => row.total),
    [4, 4],
  );
  assert.equal(rows.filter((row) => row.poll === 2).length, 4);
  assert.equal(rows.filter((row) => row.poll === 3).length, 4);
  assert.equal(
    exportResults(current, identities, settings(0)).rows.filter((row) => row.poll === 0).length,
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
    assert.equal(canExportResults(current, changed, settings(0)), false);
    assert.throws(() => exportResults(current, changed, settings(0)), /Links changed/);
  }
  assert.equal(canExportResults(current, identities, settings(4)), false);
  assert.throws(() => exportResults(current, identities, settings(4)), /No results/);
  assert.equal(canExportResults(current, identities, settings(3)), true);
  const demo = result(samplePolls(), 'demo');
  assert.equal(canExportResults(demo, [], settings(3)), true);
  assert.deepEqual(
    exportResults(demo, [], settings(3)),
    exportResults(current, identities, settings(3)),
  );
});
