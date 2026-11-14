import { pollLabels } from './labels.ts';
import type { ExportData } from '../application/export.ts';

export function csv(data: ExportData) {
  const labels = pollLabels(data.polls);
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[\s]*[=+\-@]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    '\uFEFF' +
    [
      [
        'Grouping poll',
        'Group answer',
        'Poll',
        'Option',
        'Total',
        'Explicit',
        'Implicit',
        'Participants',
        'Participants with implicit votes',
      ],
      ...data.rows.map((row) => [
        labels[row.groupPoll],
        row.groupOption,
        labels[row.poll],
        row.option,
        row.total,
        row.explicit,
        row.implicit,
        row.participants.join('; '),
        row.implicitParticipants.join('; '),
      ]),
    ]
      .map((values) => values.map(cell).join(','))
      .join('\r\n')
  );
}
