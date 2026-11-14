import type { PollData } from './domain/models.ts';

export function demo(): PollData {
  const names = {
    '1': 'Alex',
    '2': 'Morgan Lee',
    '3': 'Anna Maria Silva',
    '4': 'Sam Patel',
    '5': 'Pat',
    '6': 'Chris van Dijk',
    '7': 'Robin Chen',
    '8': 'Noor Ali Hassan',
    '9': 'Sasha',
    '10': 'Jamie de Vries',
  };
  const definitions: [string, [string, number[]][]][] = [
    [
      'What shall we discuss?',
      [
        ['Books', [1, 2, 4, 10]],
        ['AI', [2, 4, 6]],
        ['Science', [1, 5]],
        ['History', [4, 8]],
        ['Cinema', [2, 6]],
        ['Music', [1, 8]],
        ['Travel', [4, 5]],
        ['Food', [5, 6]],
        ['Art', [2, 8]],
        ['Design', [1, 4, 6]],
      ],
    ],
    [
      'Which date?',
      [
        ['14 November', [1, 2, 3, 5, 9]],
        ['15 November', [1, 3, 6, 8]],
        ['16 November', [2, 5]],
        ['17 November', [3, 6, 9]],
        ['18 November', [1, 8]],
        ['19 November', [2, 3, 5, 6]],
        ['20 November', [8, 9]],
        ['21 November', [1, 2, 6]],
        ['22 November', [3, 5, 8]],
        ['23 November', [1, 2, 3, 5, 6, 8, 9]],
      ],
    ],
    [
      'What time?',
      [
        ['18:00', [1, 2, 3, 7]],
        ['19:00', [2, 4, 6]],
        ['20:00', [1, 4, 7]],
      ],
    ],
    [
      'Where shall we meet?',
      [
        ['Park', [1, 3, 4]],
        ['Cafe', [1, 2, 5, 7]],
        ['Library', [2, 4, 5]],
      ],
    ],
  ];
  const start = Date.UTC(2026, 10, 12, 8) / 1000;
  return {
    names,
    polls: definitions.map(([title, entries], index) => {
      const options = entries.map(([text, voters]) => ({ text, voters: voters.map(String) }));
      const voters = [...new Set(options.flatMap((option) => option.voters))];
      const votedAt = Object.fromEntries(
        voters.map((id) => [
          id,
          // A known vote without a timestamp is distinct from not answering a poll.
          index === 0 && id === '8' ? null : start + index * 21600 + Number(id) * 1020,
        ]),
      );
      return { title, options, votedAt };
    }),
  };
}
