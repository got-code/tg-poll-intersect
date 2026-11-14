import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDate, filterTopics } from '../src/domain/polls.ts';
import { parseLink } from '../src/domain/links.ts';
import { readVoters } from '../src/infrastructure/telegram/voters.ts';
import { samplePolls } from './fixtures/polls.mjs';
import { csv } from '../src/domain/csv.ts';

test('each date lists its own voters and independent topic, time and place intersections', () => {
  const data = samplePolls();
  const groups = groupByDate(data.polls);
  assert.deepEqual(
    groups.map((group) => group.date),
    ['14 November', '15 November'],
  );
  assert.deepEqual(groups[0].ids, ['1', '2', '3', '4']);
  assert.deepEqual(
    groups[0].sections.map((section) => section.label),
    ['Topics', 'Time', 'Places'],
  );
  assert.deepEqual(groups[0].sections[0].options[0].ids, ['1', '2', '4']);
  assert.equal(groups[0].bestTopicCount, 3);
  assert.equal(groups[1].bestTopicCount, 3);
  assert.deepEqual(
    groups[1].sections[0].options.map((option) => option.text),
    ['AI', 'Books'],
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

test('topics with equal totals prefer explicit votes and preserve poll order for complete ties', () => {
  const polls = [
    {
      options: [
        { text: '3+2', voters: ['1', '2', '3', '5', '6'] },
        { text: '4+1', voters: ['1', '2', '3', '4', '5'] },
        { text: 'Another 4+1', voters: ['1', '2', '3', '4', '6'] },
      ],
    },
    { options: [{ text: 'Date', voters: ['1', '2', '3', '4'] }] },
    { options: [{ text: 'Time', voters: [] }] },
    { options: [{ text: 'Place', voters: [] }] },
  ];
  const [group] = groupByDate(polls);
  assert.deepEqual(
    group.sections[0].options.map((option) => option.text),
    ['4+1', 'Another 4+1', '3+2'],
  );
  assert.equal(group.bestTopicCount, 5);
  assert.equal(group.bestTopicExplicitCount, 4);
  assert.equal(group.bestTopicImplicitCount, 1);

  polls[0].options.push({ text: '3+3', voters: ['1', '2', '3', '5', '6', '7'] });
  const [larger] = groupByDate(polls);
  assert.equal(larger.sections[0].options[0].text, '3+3');
  assert.equal(larger.bestTopicCount, 6);
  assert.equal(larger.bestTopicExplicitCount, 3);
});

test('minimum applies only to topics and hides dates with no qualifying topic without altering day totals', () => {
  const groups = groupByDate(samplePolls().polls);
  const filtered = filterTopics(groups);
  assert.equal(filtered.length, 2);
  for (const group of filtered) {
    assert.equal(group.ids.length, 4);
    assert.equal(group.bestTopicCount, 3);
    assert.equal(group.sections[0].options.length, 1);
    assert.equal(group.sections[1].options.length, 2);
    assert.equal(group.sections[2].options.length, 2);
  }
  assert.equal(filtered[0].sections[2].options[1].ids.length, 1);
  assert.equal(groups[0].sections[0].options.length, 2);
  assert.equal(filterTopics(groups, 4).length, 0);
  assert.deepEqual(filterTopics(groups, 0), groups);
  const mixed = structuredClone(groups);
  mixed[1].sections[0].options[0].ids = ['3', '5'];
  assert.deepEqual(
    filterTopics(mixed, 3).map((group) => group.date),
    ['14 November'],
  );
});

test('date voters without votes elsewhere are counted once in every option with separate explicit and implicit totals', () => {
  const polls = Array.from({ length: 4 }, () => ({
    options: [{ text: 'a', voters: ['1', '1', '2'] }],
  }));
  polls[3].options[0].voters = ['1', '3'];
  polls[0].options.push({ text: 'Empty', voters: [] });
  polls[1].options[0].voters.push('4');
  const [group] = groupByDate(polls);
  assert.deepEqual(group.ids, ['1', '2', '4', '3']);
  assert.deepEqual(group.explicitIds, ['1', '2', '4']);
  assert.deepEqual(group.implicitIds, ['3']);
  assert.deepEqual(group.sections[0].options[1].ids, ['4', '3']);
  assert.deepEqual(group.sections[0].options[1].explicitIds, []);
  assert.deepEqual(group.sections[0].options[1].implicitIds, ['4', '3']);
  assert.deepEqual(group.sections[2].options[0].ids, ['1', '2', '4', '3']);
  assert.deepEqual(group.sections[2].options[0].explicitIds, ['1']);
  assert.deepEqual(group.sections[2].options[0].implicitIds, ['2', '4', '3']);
  assert.equal(group.bestTopicCount, 4);
  assert.equal(group.bestTopicExplicitCount, 2);
  assert.equal(group.bestTopicImplicitCount, 2);
  const exported = csv([group], { 1: 'Anna', 2: 'Alex', 3: 'Morgan', 4: 'Olivia' });
  assert.ok(exported.includes('"Total","Explicit","Implicit"'));
  assert.ok(exported.includes('"Date","a","4","3","1","Anna; Alex; Olivia; Morgan","Morgan"'));
  assert.ok(
    exported.includes(
      '"Places","a","4","1","3","Anna; Alex; Olivia; Morgan","Alex; Olivia; Morgan"',
    ),
  );
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
  const groups = groupByDate(polls);
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
  const allFlexible = groupByDate(polls);
  assert.equal(allFlexible[0].bestTopicCount, 4);
  assert.equal(allFlexible[0].bestTopicExplicitCount, 0);
  assert.equal(allFlexible[0].bestTopicImplicitCount, 4);
  assert.deepEqual(
    filterTopics(allFlexible, 4).map((group) => group.date),
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
    const groups = groupByDate(polls);
    const options =
      missingPoll === 1 ? groups : groups[0].sections[[0, -1, 1, 2][missingPoll]].options;
    for (const option of options) {
      assert.ok(
        option.implicitIds.includes('2'),
        `poll ${missingPoll}: ${option.text ?? option.date}`,
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
  const groups = groupByDate(polls);
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
  assert.ok(groupByDate(polls).every((group) => group.ids.length === 0));
});

test('public, private and forum message links', () => {
  assert.equal(parseLink('https://t.me/group_chat/123').peer, 'group_chat');
  assert.deepEqual(parseLink('https://t.me/c/1234567890/10/42?single').messageId, 42);
  assert.equal(parseLink('https://t.me/c/1234567890/42').peer, -1001234567890);
  assert.equal(parseLink('https://t.me/c/12345/42').peer, -1000000012345);
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
  const [group] = groupByDate(polls);
  assert.deepEqual(group.votesByPerson['3'], [
    { label: 'Topic', voted: true, at: null },
    { label: 'Date', voted: false, at: null },
    { label: 'Time', voted: false, at: null },
    { label: 'Place', voted: false, at: null },
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

test('CSV quotes untrusted labels, neutralizes spreadsheet formulas, preserves multiline values', () => {
  const output = csv(
    [
      {
        date: 'date',
        ids: ['123'],
        sections: [
          {
            label: 'Topics',
            options: [
              { text: '=SUM(1,2)', ids: ['123'] },
              { text: '"18:00"', ids: ['123'] },
              { text: 'Cafe\ncentre', ids: [] },
            ],
          },
        ],
      },
    ],
    { 123: '@evil' },
  );
  assert.ok(output.startsWith('\uFEFF'));
  assert.ok(output.includes('"\'=SUM(1,2)"'));
  assert.ok(output.includes('"\'@evil"'));
  assert.ok(output.includes('"""18:00"""'));
  assert.ok(output.includes('"Cafe\ncentre"'));
});

test('CSV exports names and counts without IDs, including when a name is missing', () => {
  const id = 'user:987654321012';
  const output = csv(
    [
      {
        date: 'Date',
        ids: [id],
        sections: [{ label: 'Topics', options: [{ text: 'Topic', ids: [id], implicitIds: [id] }] }],
      },
    ],
    {},
  );
  assert.ok(!output.includes('987654321012'));
  assert.ok(!output.includes('user:'));
  assert.ok(!output.includes('Telegram ID'));
  assert.ok(output.includes('Unnamed participant'));
});
