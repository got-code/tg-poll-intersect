import { SECTION_LABELS } from './labels.ts';
import type { ExportRow } from '../application/export.ts';

export function csv(rows: readonly ExportRow[]) {
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[\s]*[=+\-@]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    '\uFEFF' +
    [
      [
        'Date',
        'Section',
        'Option',
        'Total',
        'Explicit',
        'Implicit',
        'Participants',
        'Participants with implicit votes',
      ],
      ...rows.map((row) => [
        row.date,
        SECTION_LABELS[row.section],
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
