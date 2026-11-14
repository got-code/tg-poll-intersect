export function identifyPolls(polls) {
  return polls.map((poll, index) => ({ id: `poll:${index + 1}`, ...poll }));
}

// Small, stable fixtures for intersection and rendering assertions.
export function samplePolls() {
  const names = { 1: 'Alex', 2: 'Morgan', 3: 'Anna', 4: 'Sam', 5: 'Pat', 6: 'Chris' };
  const options = (entries) =>
    entries.map(([text, voters]) => ({ text, voters: voters.map(String) }));
  return {
    names,
    polls: identifyPolls([
      {
        options: options([
          ['Books', [1, 2, 4]],
          ['AI', [2, 3, 5, 6]],
        ]),
      },
      {
        options: options([
          ['14 November', [1, 2, 3, 4]],
          ['15 November', [3, 4, 5, 6]],
        ]),
      },
      {
        options: options([
          ['18:00', [1, 2, 3, 5]],
          ['19:00', [3, 4, 6]],
        ]),
      },
      {
        options: options([
          ['Park', [1, 2, 4]],
          ['Cafe', [3, 5, 6]],
        ]),
      },
    ]),
  };
}
