import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demo } from '../src/demo.ts';
import { groupByDate, filterTopics } from '../src/domain/polls.ts';

test('demo has ten dates, topics and people, three times and places, and one-to-three-word names', () => {
  const data = demo();
  assert.equal(Object.keys(data.names).length, 10);
  assert.deepEqual(
    data.polls.map((poll) => poll.options.length),
    [10, 10, 3, 3],
  );
  assert.deepEqual(
    [...new Set(Object.values(data.names).map((name) => name.split(/\s+/).length))].sort(),
    [1, 2, 3],
  );
  for (const poll of data.polls)
    for (const option of poll.options) {
      assert.ok(option.voters.length > 0);
      assert.equal(new Set(option.voters).size, option.voters.length);
      assert.ok(option.voters.every((id) => data.names[id]));
    }
  const groups = groupByDate(data.polls);
  assert.equal(filterTopics(groups).length, 10);
  assert.equal(filterTopics(groups, 11).length, 0);
  assert.ok(groups.some((group) => group.ids.length === 10));
});

test('demo includes full votes, single and multiple omissions, multiple choices, and an unavailable timestamp', () => {
  const { polls } = demo();
  const [group] = groupByDate(polls);
  const mask = (id) => group.votesByPerson[id].map((vote) => Number(vote.voted)).join('');
  assert.deepEqual(['1', '3', '4', '5', '6', '7', '8', '9', '10'].map(mask), [
    '1111',
    '0111',
    '1011',
    '1101',
    '1110',
    '0011',
    '1100',
    '0100',
    '1000',
  ]);
  assert.equal(polls[0].options.filter((option) => option.voters.includes('2')).length > 1, true);
  assert.deepEqual(group.votesByPerson['8'][0], { label: 'Topic', voted: true, at: null });
  assert.ok(group.votesByPerson['1'].every((vote) => Number.isInteger(vote.at) && vote.at > 0));
  const fresh = demo();
  polls[0].options[0].voters.length = 0;
  assert.ok(fresh.polls[0].options[0].voters.length > 0);
});
