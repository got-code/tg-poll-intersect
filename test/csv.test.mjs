import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csv } from '../src/modules/polls/presentation/csv.ts';
import { exportResults } from '../src/modules/polls/application/export.ts';
import { groupByDate } from '../src/modules/polls/domain/polls.ts';

const row = {
  date: 'Date',
  section: 'topic',
  option: 'Topic',
  total: 2,
  explicit: 1,
  implicit: 1,
  participants: ['Anna', 'Alex'],
  implicitParticipants: ['Alex'],
};

test('CSV adds a UTF-8 BOM and CRLF rows, preserving column order, counts and participant separators', () => {
  const output = csv([row]);
  assert.equal(
    output,
    '\uFEFF"Date","Section","Option","Total","Explicit","Implicit","Participants","Participants with implicit votes"\r\n"Date","Topics","Topic","2","1","1","Anna; Alex","Alex"',
  );
});

test('CSV quotes untrusted text and multiline values and neutralizes spreadsheet formulas in every external text column', () => {
  const output = csv([
    { ...row, option: '=SUM(1,2)', participants: ['@evil'] },
    { ...row, option: '"18:00"' },
    { ...row, option: 'Cafe\ncentre' },
  ]);
  assert.ok(output.includes('"\'=SUM(1,2)"'));
  assert.ok(output.includes('"\'@evil"'));
  assert.ok(output.includes('"""18:00"""'));
  assert.ok(output.includes('"Cafe\ncentre"'));
  for (const formula of ['=1', '+1', '-1', '@evil', ' \t=1', '\n+1']) {
    const escaped = csv([
      {
        ...row,
        date: formula,
        option: formula,
        participants: [formula],
        implicitParticipants: [formula],
      },
    ]);
    assert.equal(escaped.split(`"'${formula}"`).length - 1, 4);
  }
});

test('the complete export preserves explicit and implicit counts and excludes Telegram IDs', () => {
  const polls = Array.from({ length: 4 }, () => ({
    options: [{ text: 'a', voters: ['1', '1', '2'] }],
  }));
  polls[3].options[0].voters = ['1', '3'];
  polls[0].options.push({ text: 'Empty', voters: [] });
  polls[1].options[0].voters.push('4');
  const result = {
    groups: groupByDate(polls),
    names: { 1: 'Anna', 2: 'Alex', 3: 'Morgan', 4: 'Olivia' },
    kind: 'demo',
    sourceLinks: [],
    updatedAt: new Date(0),
  };
  const output = csv(exportResults(result, [], 0));
  assert.ok(output.includes('"Date","a","4","3","1","Anna; Alex; Olivia; Morgan","Morgan"'));
  assert.ok(
    output.includes('"Places","a","4","1","3","Anna; Alex; Olivia; Morgan","Alex; Olivia; Morgan"'),
  );
  assert.ok(!output.includes('Telegram ID'));
});
