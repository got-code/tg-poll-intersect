import type { PollData } from '../domain/models.ts';

export function demo(): PollData {
  const people = [
    ['user:18472963', 'Alex'],
    ['user:492816307', 'Morgan Lee'],
    ['user:6842051937', 'Anna Maria Silva'],
    ['user:278461905', 'Sam Patel'],
    ['user:7531908624', 'Pat'],
    ['user:938421756', 'Chris van Dijk'],
    ['user:261839470', 'Robin Chen'],
    ['user:4391762085', 'Noor Ali Hassan'],
    ['user:9826417350', 'Sasha'],
    ['user:3567829012345678', 'Jamie de Vries'],
  ] as const;
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
    names: Object.fromEntries(people),
    polls: definitions.map(([title, entries], index) => {
      const options = entries.map(([text, voters]) => ({
        text,
        voters: voters.map((person) => people[person - 1][0]),
      }));
      const voters = [...new Set(entries.flatMap(([, voters]) => voters))];
      const votedAt = Object.fromEntries(
        voters.map((person) => [
          people[person - 1][0],
          // A known vote without a timestamp is distinct from not answering a poll.
          index === 0 && person === 8 ? null : start + index * 21600 + person * 1020,
        ]),
      );
      return { id: `demo:${index + 1}`, title, options, votedAt };
    }),
  };
}
