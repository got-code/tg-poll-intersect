export function csv(groups, names) {
  const cell = value => {
    let text = String(value);
    if (/^[\s]*[=+\-@]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const row = (date, section, option, ids, implicitIds = []) => [
    date, section, option, ids.length, ids.length - implicitIds.length, implicitIds.length,
    ids.map(id => names[id] || 'Unnamed participant').join('; '),
    implicitIds.map(id => names[id] || 'Unnamed participant').join('; '),
  ];
  return '\uFEFF' + [
    ['Date', 'Section', 'Option', 'Total', 'Explicit', 'Implicit', 'Participants', 'Participants with implicit votes'],
    ...groups.flatMap(group => [
      row(group.date, 'Date', group.date, group.ids, group.implicitIds),
      ...group.sections.flatMap(section => section.options.map(option => row(group.date, section.label, option.text, option.ids, option.implicitIds))),
    ]),
  ].map(values => values.map(cell).join(',')).join('\r\n');
}

