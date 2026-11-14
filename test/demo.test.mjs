import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demo } from '../src/modules/polls/infrastructure/demo.ts';
import { groupPolls, filterGroups } from '../src/modules/polls/domain/polls.ts';
import { createPollResults, selectResultGroups } from '../src/modules/polls/application/results.ts';

test('the help example matches the demo preset, participant totals and filtering thresholds', () => {
  const result = createPollResults({
    source: {
      load() {
        throw new Error('Demo must stay offline');
      },
    },
    demo,
  }).demo();
  const settings = result.viewSettings;
  assert.equal(result.polls.find((poll) => poll.id === settings.groupBy).title, 'Which date?');
  assert.equal(
    result.polls.find((poll) => poll.id === settings.filterBy.pollId).title,
    'What shall we discuss?',
  );
  const card = (minimumParticipants) =>
    selectResultGroups(result, { ...settings, minimumParticipants }).find(
      (group) => group.option === '16 November',
    );
  const options = card(0).sections.find(
    (section) => section.pollId === settings.filterBy.pollId,
  ).options;
  for (const [text, total] of [
    ['Books', 4],
    ['AI', 3],
    ['Science', 2],
  ]) {
    assert.equal(options.find((option) => option.text === text).ids.length, total, text);
  }
  assert.deepEqual(
    card(3)
      .sections.find((section) => section.pollId === settings.filterBy.pollId)
      .options.map((option) => option.text),
    ['Books', 'AI', 'Travel'],
  );
  assert.equal(card(5), undefined);
});

test('demo has ten dates, topics and people, three times and places, and one-to-three-word names', () => {
  const data = demo();
  assert.equal(Object.keys(data.names).length, 10);
  const ids = Object.keys(data.names);
  assert.ok(ids.every((id) => /^user:\d{8,16}$/.test(id)));
  assert.ok(new Set(ids.map((id) => id.slice(5).length)).size >= 3);
  assert.ok(ids.every((id) => BigInt(id.slice(5)) < 2n ** 52n));
  assert.deepEqual(
    data.polls.map((poll) => poll.options.length),
    [10, 10, 3, 3],
  );
  assert.deepEqual(
    [...new Set(Object.values(data.names).map((name) => name.split(/\s+/).length))].sort(),
    [1, 2, 3],
  );
  for (const poll of data.polls) {
    assert.deepEqual(
      new Set(Object.keys(poll.votedAt)),
      new Set(poll.options.flatMap((option) => option.voters)),
    );
    for (const option of poll.options) {
      assert.ok(option.voters.length > 0);
      assert.equal(new Set(option.voters).size, option.voters.length);
      assert.ok(option.voters.every((id) => data.names[id]));
    }
  }
  const groups = groupPolls(data.polls, data.polls[1].id);
  assert.equal(filterGroups(groups, data.polls[0].id, 3).length, 10);
  assert.equal(filterGroups(groups, data.polls[0].id, 11).length, 0);
  assert.ok(groups.some((group) => group.ids.length === 10));
});

test('demo includes full votes, single and multiple omissions, multiple choices, and an unavailable timestamp', () => {
  const { polls, names } = demo();
  const idFor = (name) => Object.entries(names).find(([, value]) => value === name)[0];
  const [group] = groupPolls(polls, polls[1].id);
  const mask = (name) =>
    group.votesByPerson[idFor(name)].map((vote) => Number(vote.voted)).join('');
  assert.deepEqual(
    [
      'Alex',
      'Anna Maria Silva',
      'Sam Patel',
      'Pat',
      'Chris van Dijk',
      'Robin Chen',
      'Noor Ali Hassan',
      'Sasha',
      'Jamie de Vries',
    ].map(mask),
    ['1111', '0111', '1011', '1101', '1110', '0011', '1100', '0100', '1000'],
  );
  assert.equal(
    polls[0].options.filter((option) => option.voters.includes(idFor('Morgan Lee'))).length > 1,
    true,
  );
  assert.deepEqual(group.votesByPerson[idFor('Noor Ali Hassan')][0], {
    pollId: 'demo:1',
    voted: true,
    at: null,
  });
  assert.ok(
    group.votesByPerson[idFor('Alex')].every((vote) => Number.isInteger(vote.at) && vote.at > 0),
  );
  assert.equal(polls[1].votedAt[idFor('Anna Maria Silva')], Date.UTC(2026, 10, 12, 14, 51) / 1000);
  const fresh = demo();
  polls[0].options[0].voters.length = 0;
  assert.ok(fresh.polls[0].options[0].voters.length > 0);
});
