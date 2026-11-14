import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPolls, filterGroups } from '../src/modules/polls/domain/polls.ts';
import { parseLink } from '../src/modules/polls/application/links.ts';
import { readVoters } from '../src/modules/polls/infrastructure/voters.ts';
import { samplePolls, identifyPolls } from './fixtures/polls.mjs';

const groupOnSecond = (polls) => groupPolls(identifyPolls(polls), 'poll:2');

test('each date lists its own voters and independent topic, time and place intersections', () => {
  const data = samplePolls();
  const groups = groupOnSecond(data.polls);
  assert.deepEqual(
    groups.map((group) => group.option),
    ['14 November', '15 November'],
  );
  assert.deepEqual(groups[0].ids, ['1', '2', '3', '4']);
  assert.deepEqual(
    groups[0].sections.map((section) => section.pollId),
    ['poll:1', 'poll:3', 'poll:4'],
  );
  assert.deepEqual(groups[0].sections[0].options[0].ids, ['1', '2', '4']);
  assert.deepEqual(
    groups[1].sections[0].options.map((option) => option.text),
    ['Books', 'AI'],
  );
  assert.deepEqual(groups[0].sections[1].options[0].ids, ['1', '2', '3']);
  assert.deepEqual(groups[0].sections[2].options[0].ids, ['1', '2', '4']);
  assert.deepEqual(groups[1].sections[2].options[1].ids, ['3', '5', '6']);
  for (let d = 0; d < groups.length; d++) {
    for (let s = 0; s < 3; s++) {
      const source = data.polls[[0, 2, 3][s]];
      groups[d].sections[s].options.forEach((option) => {
        const original = source.options.find((item) => item.text === option.text);
        const expected = Object.keys(data.names).filter(
          (id) =>
            data.polls[1].options[d].voters.includes(id) &&
            (original.voters.includes(id) ||
              !source.options.some((item) => item.voters.includes(id))),
        );
        assert.deepEqual(option.ids, expected);
        assert.equal(option.explicitIds.length + option.implicitIds.length, option.ids.length);
      });
    }
  }
});

test('group and section options preserve Telegram order regardless of popularity', () => {
  const polls = identifyPolls([
    {
      options: [
        { text: 'Less', voters: ['1'] },
        { text: 'More', voters: ['1', '2'] },
      ],
    },
    {
      options: [
        { text: 'First', voters: ['1', '2'] },
        { text: 'Second', voters: [] },
      ],
    },
  ]);
  const groups = groupPolls(polls, polls[1].id);
  assert.deepEqual(
    groups.map((item) => item.option),
    ['First', 'Second'],
  );
  assert.deepEqual(
    groups[0].sections[0].options.map((item) => item.text),
    ['Less', 'More'],
  );
});

test('minimum applies only to topics and hides dates with no qualifying topic without altering day totals', () => {
  const groups = groupOnSecond(samplePolls().polls);
  const filtered = filterGroups(groups, 'poll:1', 3);
  assert.equal(filtered.length, 2);
  for (const group of filtered) {
    assert.equal(group.ids.length, 4);
    assert.equal(group.sections[0].options.length, 1);
    assert.equal(group.sections[1].options.length, 2);
    assert.equal(group.sections[2].options.length, 2);
  }
  assert.equal(filtered[0].sections[2].options[1].ids.length, 1);
  assert.equal(groups[0].sections[0].options.length, 2);
  assert.equal(filterGroups(groups, 'poll:1', 4).length, 0);
  assert.deepEqual(filterGroups(groups, 'poll:1', 0), groups);
  const mixed = structuredClone(groups);
  mixed[1].sections[0].options[1].ids = ['3', '5'];
  assert.deepEqual(
    filterGroups(mixed, 'poll:1', 3).map((group) => group.option),
    ['14 November'],
  );
});

test('filtering enforces the numeric threshold contract without coercion or application defaults', () => {
  const groups = groupOnSecond(samplePolls().polls);
  for (const minimum of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '3', null, undefined])
    assert.throws(() => filterGroups(groups, 'poll:1', minimum), /Participant minimum/);
  assert.deepEqual(filterGroups(groups, 'poll:1', 0), groups);
});

test('date voters without votes elsewhere are counted once in every option with separate explicit and implicit totals', () => {
  const polls = Array.from({ length: 4 }, () => ({
    options: [{ text: 'a', voters: ['1', '1', '2'] }],
  }));
  polls[3].options[0].voters = ['1', '3'];
  polls[0].options.push({ text: 'Empty', voters: [] });
  polls[1].options[0].voters.push('4');
  const [group] = groupOnSecond(polls);
  assert.deepEqual(group.ids, ['1', '2', '4', '3']);
  assert.deepEqual(group.explicitIds, ['1', '2', '4']);
  assert.deepEqual(group.implicitIds, ['3']);
  assert.deepEqual(group.sections[0].options[1].ids, ['4', '3']);
  assert.deepEqual(group.sections[0].options[1].explicitIds, []);
  assert.deepEqual(group.sections[0].options[1].implicitIds, ['4', '3']);
  assert.deepEqual(group.sections[2].options[0].ids, ['1', '2', '4', '3']);
  assert.deepEqual(group.sections[2].options[0].explicitIds, ['1']);
  assert.deepEqual(group.sections[2].options[0].implicitIds, ['2', '4', '3']);
});

test('abstention in any poll includes its options but never overrides an explicit different choice', () => {
  const options = (entries) => entries.map(([text, voters]) => ({ text, voters }));
  const polls = [
    {
      options: options([
        ['A', ['1', '5']],
        ['B', ['3']],
      ]),
    },
    {
      options: options([
        ['D1', ['1', '2', '3']],
        ['D2', ['2', '4']],
      ]),
    },
    {
      options: options([
        ['18', ['1', '2', '5']],
        ['19', ['4']],
      ]),
    },
    {
      options: options([
        ['Park', ['2', '5']],
        ['Cafe', ['1']],
      ]),
    },
  ];
  const groups = groupOnSecond(polls);
  assert.deepEqual(groups[0].sections[0].options[0].ids, ['1', '2', '5']);
  assert.deepEqual(groups[0].sections[0].options[1].ids, ['3', '2']);
  assert.deepEqual(groups[0].sections[1].options[1].ids, ['3']);
  assert.deepEqual(groups[1].sections[1].options[0].ids, ['2', '5']);
  assert.deepEqual(groups[1].sections[2].options[1].ids, ['4']);
  assert.deepEqual(groups[0].implicitIds, ['5']);
  assert.deepEqual(groups[1].implicitIds, ['5']);
  assert.ok(
    groups.every((group) =>
      group.sections[0].options.find((option) => option.text === 'A').implicitIds.includes('5'),
    ),
  );
  assert.ok(
    groups.every(
      (group) => !group.sections[0].options.find((option) => option.text === 'B').ids.includes('5'),
    ),
  );
  for (const group of groups)
    for (const section of group.sections)
      for (const option of section.options) {
        assert.deepEqual(option.ids, [...option.explicitIds, ...option.implicitIds]);
      }
  // An entirely unanswered topic poll makes every date voter eligible for every topic.
  polls[0].options.forEach((option) => {
    option.voters = [];
  });
  const allFlexible = groupOnSecond(polls);
  assert.deepEqual(
    filterGroups(allFlexible, 'poll:1', 4).map((group) => group.option),
    ['D1'],
  );
});

test('the same missing-vote rule applies to all four polls; double abstention counts a person once', () => {
  for (let missingPoll = 0; missingPoll < 4; missingPoll++) {
    const polls = Array.from({ length: 4 }, () => ({
      options: [
        { text: 'A', voters: ['1', '2'] },
        { text: 'B', voters: [] },
      ],
    }));
    polls[missingPoll].options[0].voters = ['1'];
    const groups = groupOnSecond(polls);
    const options =
      missingPoll === 1 ? groups : groups[0].sections[[0, -1, 1, 2][missingPoll]].options;
    for (const option of options) {
      assert.ok(
        option.implicitIds.includes('2'),
        `poll ${missingPoll}: ${option.text ?? option.option}`,
      );
      assert.equal(option.ids.filter((id) => id === '2').length, 1);
    }
  }
  const polls = Array.from({ length: 4 }, () => ({
    options: [
      { text: 'A', voters: [] },
      { text: 'B', voters: [] },
    ],
  }));
  polls[3].options[0].voters = ['1', '1'];
  const groups = groupOnSecond(polls);
  for (const group of groups) {
    assert.deepEqual(group.explicitIds, []);
    assert.deepEqual(group.implicitIds, ['1']);
    for (const section of group.sections.slice(0, 2))
      for (const option of section.options) {
        assert.deepEqual(option.ids, ['1']);
        assert.deepEqual(option.explicitIds, []);
        assert.deepEqual(option.implicitIds, ['1']);
      }
  }
  polls[3].options[0].voters = [];
  assert.ok(groupOnSecond(polls).every((group) => group.ids.length === 0));
});

test('public, private and forum message links', () => {
  assert.deepEqual(parseLink('https://t.me/group_chat/123').peer, {
    kind: 'username',
    name: 'group_chat',
  });
  assert.deepEqual(parseLink('https://t.me/c/1234567890/10/42?single').messageId, 42);
  assert.deepEqual(parseLink('https://t.me/c/1234567890/42').peer, {
    kind: 'channel',
    id: 1234567890,
  });
  assert.deepEqual(parseLink('https://t.me/c/12345/42').peer, { kind: 'channel', id: 12345 });
  assert.equal(parseLink('https://t.me/group_chat/10/42').messageId, 42);
  for (const bad of [
    'https://evil.com/group/42',
    'https://t.me/+invite',
    'javascript:alert(1)',
    'https://t.me/group/0',
    'https://t.me/group/2147483648',
    'https://t.me/group/x/12',
    'https://t.me/c/999999999999999999/1',
    'https://user:password@t.me/group/12',
  ]) {
    assert.throws(() => parseLink(bad), undefined, bad);
  }
});

test('fetches every voter page, including a complete empty option', async () => {
  const cursors = [];
  const result = await readVoters(async (offset) => {
    cursors.push(offset);
    return offset
      ? {
          count: 3,
          people: [
            { id: '2', name: 'Same' },
            { id: '3', name: 'Last' },
          ],
        }
      : { count: 3, people: [{ id: '1', name: 'Same' }], nextOffset: 'page2' };
  }, 3);
  assert.deepEqual(cursors, ['', 'page2']);
  assert.deepEqual(result.ids, ['1', '2', '3']);
  assert.equal(result.names['1'], result.names['2']);
  assert.deepEqual((await readVoters(async () => ({ count: 0, people: [] }), 0)).ids, []);
});

test('pagination retains the latest vote time and distinguishes missing metadata from missing votes', async () => {
  const start = Date.UTC(2026, 10, 12, 12) / 1000;
  const result = await readVoters(
    async (offset) =>
      offset
        ? {
            count: 3,
            people: [
              { id: 2, name: 'Second', votedAt: start + 60 },
              { id: 3, name: 'Third', votedAt: Infinity },
            ],
          }
        : {
            count: 3,
            people: [
              { id: 1, name: 'First', votedAt: start },
              { id: 2, name: 'Second', votedAt: start },
            ],
            nextOffset: 'next',
          },
    3,
  );
  assert.deepEqual(result.ids, ['1', '2', '3']);
  assert.deepEqual(result.votedAt, { 1: start, 2: start + 60 });
  const polls = Array.from({ length: 4 }, (_, index) => ({
    options: [{ text: 'Option', voters: index === 0 ? ['1', '2', '3'] : ['1'] }],
    votedAt: index === 0 ? result.votedAt : { 1: start },
  }));
  const [group] = groupOnSecond(polls);
  assert.deepEqual(group.votesByPerson['3'], [
    { pollId: 'poll:1', voted: true, at: null },
    { pollId: 'poll:2', voted: false, at: null },
    { pollId: 'poll:3', voted: false, at: null },
    { pollId: 'poll:4', voted: false, at: null },
  ]);
  assert.equal(group.votesByPerson['2'][0].at, start + 60);
});

test('rejects missing pages, repeated cursors and changing totals', async () => {
  await assert.rejects(
    readVoters(async () => ({ count: 3, people: [{ id: 1 }] }), 3),
    /incomplete/,
  );
  await assert.rejects(
    readVoters(async () => ({ count: 3, people: [{ id: 1 }], nextOffset: 'same' }), 3),
    /repeated/,
  );
  let n = 0;
  await assert.rejects(
    readVoters(async () => ({ count: ++n, people: [{ id: 1 }], nextOffset: 'next' }), 1),
    /changed/,
  );
  await assert.rejects(
    readVoters(async () => ({ count: 1, people: [{ id: 1 }] }), 2),
    /changed/,
  );
});

test('any number of polls can group by any identity with independent explicit and implicit intersections', () => {
  for (const count of [1, 2, 3, 5, 8]) {
    const polls = identifyPolls(
      Array.from({ length: count }, (_, index) => ({
        title: 'Same question',
        options: [
          { text: 'A', voters: ['1', ...(index % 2 ? ['2'] : [])] },
          { text: 'B', voters: index % 3 ? ['3', '3'] : [] },
        ],
      })),
    );
    const before = structuredClone(polls);
    const allVoters = [
      ...new Set(polls.flatMap((poll) => poll.options.flatMap((option) => option.voters))),
    ];
    for (const grouping of polls) {
      const groups = groupPolls(polls, grouping.id);
      assert.equal(groups.length, 2);
      groups.forEach((group, index) => {
        const accepts = (poll, option, id) =>
          option.voters.includes(id) || !poll.options.some((answer) => answer.voters.includes(id));
        const expected = allVoters.filter((id) => accepts(grouping, grouping.options[index], id));
        assert.deepEqual(new Set(group.ids), new Set(expected));
        assert.equal(group.sections.length, count - 1);
        assert.deepEqual(
          group.sections.map((section) => section.pollId),
          polls.filter((poll) => poll.id !== grouping.id).map((poll) => poll.id),
        );
        for (const section of group.sections) {
          const source = polls.find((poll) => poll.id === section.pollId);
          section.options.forEach((option, answerIndex) => {
            const match = expected.filter((id) => accepts(source, source.options[answerIndex], id));
            assert.deepEqual(new Set(option.ids), new Set(match));
            assert.equal(new Set(option.ids).size, option.ids.length);
            assert.deepEqual(
              new Set(option.explicitIds),
              new Set(
                match.filter(
                  (id) =>
                    grouping.options[index].voters.includes(id) &&
                    source.options[answerIndex].voters.includes(id),
                ),
              ),
            );
            assert.deepEqual(option.ids, [...option.explicitIds, ...option.implicitIds]);
          });
        }
      });
      assert.deepEqual(filterGroups(groups, null, 100), groups);
      assert.deepEqual(
        filterGroups(groups, grouping.id, 2),
        groups.filter((group) => group.ids.length >= 2),
      );
    }
    assert.deepEqual(polls, before);
  }
});

test('poll invariants reject missing options, duplicate identities and invalid selections', () => {
  const polls = identifyPolls([{ options: [{ text: 'A', voters: [] }] }]);
  assert.throws(() => groupPolls([], 'poll:1'), /At least one/);
  assert.throws(() => groupPolls([{ id: 'empty', options: [] }], 'empty'), /answer options/);
  assert.throws(() => groupPolls([...polls, ...polls], 'poll:1'), /distinct identity/);
  assert.throws(() => groupPolls(polls, 'removed'), /loaded poll/);
  assert.throws(() => filterGroups(groupPolls(polls, 'poll:1'), 'removed', 0), /loaded poll/);
});
