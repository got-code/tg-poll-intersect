import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPolls, filterGroups } from '../src/modules/polls/domain/polls.ts';
import { samplePolls, identifyPolls } from './fixtures/polls.mjs';
import { createResultsRenderer } from '../src/modules/polls/presentation/results.ts';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.isConnected = true;
    this.style = {};
    this.attributes = {};
    this.handlers = {};
    this.offsetWidth = 188;
    this.offsetHeight = 32;
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  addEventListener(type, handler) {
    this.handlers[type] = handler;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  removeAttribute(key) {
    delete this.attributes[key];
  }
  getBoundingClientRect() {
    return { left: 280, top: 50, bottom: 70 };
  }
  emit(type, event = {}) {
    if (type === 'focus') document.activeElement = this;
    if (type === 'blur') document.activeElement = null;
    this.handlers[type]?.(event);
  }
}
function find(node, predicate) {
  return [
    ...(predicate(node) ? [node] : []),
    ...node.children.flatMap((child) => find(child, predicate)),
  ];
}

test('date cards expose every name/count in topic-time-place order; IDs appear only in a dismissible tooltip', async () => {
  const body = new Element('body');
  const docEvents = {},
    windowEvents = {};
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    body,
    addEventListener: (type, handler) => {
      docEvents[type] = handler;
    },
  };
  globalThis.window = {
    innerWidth: 320,
    innerHeight: 640,
    addEventListener: (type, handler) => {
      windowEvents[type] = handler;
    },
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  const container = new Element('main');
  const render = createResultsRenderer(container);
  const data = samplePolls();
  render(groupPolls(data.polls, 'poll:2'), data.names, data.polls);
  assert.equal(container.children.length, 2);
  assert.deepEqual(
    find(container.children[0], (el) => el.tag === 'h4').map((el) => el.textContent),
    ['Poll 1', 'Poll 3', 'Poll 4'],
  );
  assert.equal(find(container, (el) => el.className === 'group-option').length, 12);
  assert.deepEqual(
    find(container, (el) => el.className === 'group-count').map((el) => el.textContent),
    ['Participants: 4', 'Participants: 4'],
  );
  assert.equal(find(container, (el) => el.className === 'option-count')[0].textContent, '3');
  const buttons = find(container, (el) => el.className === 'person');
  assert.ok(buttons.length > 8);
  assert.ok(buttons.every((button) => Object.values(data.names).includes(button.textContent)));
  assert.equal(find(container, (el) => /Telegram ID|user:/.test(el.textContent)).length, 0);

  const vasya = buttons.find((button) => button.textContent === 'Alex');
  vasya.emit('click');
  const tooltip = body.children[0];
  assert.equal(
    tooltip.textContent,
    ['Poll 1', 'Poll 2', 'Poll 3', 'Poll 4']
      .map((label) => `“${label}” — time unavailable`)
      .concat('Telegram ID: 1')
      .join('\n'),
  );
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.style.left, '124px'); // Clamped to the narrow screen.
  assert.equal(vasya.attributes['aria-describedby'], 'personTooltip');
  docEvents.scroll({ target: tooltip });
  assert.equal(tooltip.hidden, false);
  docEvents.scroll({ target: container });
  assert.equal(tooltip.hidden, true);
  vasya.emit('click');
  docEvents.keydown({ key: 'Escape' });
  assert.equal(tooltip.hidden, true);
  assert.equal(vasya.attributes['aria-describedby'], undefined);
  vasya.emit('mouseenter');
  assert.equal(tooltip.hidden, false);
  vasya.emit('mouseleave');
  tooltip.emit('mouseenter');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(tooltip.hidden, false);
  tooltip.emit('mouseleave');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(tooltip.hidden, true);
  vasya.emit('focus');
  assert.equal(tooltip.hidden, false);
  const morgan = buttons.find((button) => button.textContent === 'Morgan');
  morgan.emit('mouseenter');
  assert.match(tooltip.textContent, /Telegram ID: 1/);
  morgan.emit('mousemove');
  assert.match(tooltip.textContent, /Telegram ID: 2/);
  morgan.emit('mouseleave');
  docEvents.pointerdown({ target: container });
  assert.equal(tooltip.hidden, true);
  vasya.emit('click');
  render([], {}, []);
  assert.equal(container.children.length, 0);
  assert.equal(tooltip.hidden, true);
  render(filterGroups(groupPolls(data.polls, 'poll:2'), 'poll:1', 3), data.names, data.polls);
  assert.equal(find(container, (el) => el.className === 'group-option').length, 10);
  render(filterGroups(groupPolls(data.polls, 'poll:2'), 'poll:1', 4), data.names, data.polls);
  assert.equal(container.children.length, 0);
  // Sasha did not answer the topic poll; totals and names distinguish this case.
  data.polls[0].options[0].voters = ['1', '2'];
  const flexible = groupPolls(data.polls, 'poll:2');
  render(flexible, data.names, data.polls);
  const implicit = find(container, (el) => el.className === 'person implicit');
  assert.ok(implicit.length > 0);
  assert.ok(implicit.every((button) => button.textContent === 'Sam'));
  for (const button of implicit) {
    button.emit('click');
    assert.match(tooltip.textContent, /“Poll 1” — no vote/);
  }
  const count = find(container, (el) => el.className === 'option-count')[0];
  assert.equal(count.textContent, '2(+1?)');
  count.emit('click');
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /1 person has no vote/);
  assert.match(tooltip.textContent, /no vote in “Poll 2” or “Poll 1”/);
  assert.match(tooltip.textContent, /Total: 3/);
  for (const row of find(container, (el) => el.className === 'group-option')) {
    const names = find(
      row,
      (el) => el.className === 'person' || el.className === 'person implicit',
    );
    const firstImplicit = names.findIndex((el) => el.className === 'person implicit');
    if (firstImplicit >= 0)
      assert.ok(names.slice(firstImplicit).every((el) => el.className === 'person implicit'));
  }
  const lastTopic = find(container.children[1], (el) => el.className === 'group-option')[1];
  assert.deepEqual(
    find(lastTopic, (el) => el.className === 'person' || el.className === 'person implicit').map(
      (el) => el.textContent,
    ),
    ['Anna', 'Pat', 'Chris', 'Sam'],
  );
  const missingDate = samplePolls();
  missingDate.polls[1].options[1].voters = ['3', '4', '6'];
  render(groupPolls(missingDate.polls, 'poll:2'), missingDate.names, missingDate.polls);
  assert.deepEqual(
    find(container, (el) => el.className === 'group-count').map((el) => el.textContent),
    ['Participants: 4(+1?)', 'Participants: 3(+1?)'],
  );
  const datePeople = find(container.children[0], (el) => el.className === 'group-attendees')[0];
  const dayNames = find(
    datePeople,
    (el) => el.className === 'person' || el.className === 'person implicit',
  );
  assert.equal(dayNames.at(-1).textContent, 'Pat');
  assert.equal(dayNames.at(-1).className, 'person implicit');
  const dayCount = find(container, (el) => el.className === 'group-count')[0];
  dayCount.emit('click');
  assert.match(tooltip.textContent, /no vote in “Poll 2”/);
  assert.match(tooltip.textContent, /Total: 5/);
  const inferredTime = find(container.children[0], (el) => el.className === 'group-option').find(
    (row) => row.children[0].textContent === '18:00',
  );
  assert.equal(
    find(inferredTime, (el) => el.className === 'option-count')[0].textContent,
    '3(+1?)',
  );
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.requestAnimationFrame;
});

test('day and option names share all four vote times, missing votes first, with context-specific implicit styling', () => {
  const body = new Element('body');
  globalThis.document = { createElement: (tag) => new Element(tag), body, addEventListener() {} };
  globalThis.window = { innerWidth: 390, innerHeight: 844, addEventListener() {} };
  const container = new Element('main');
  const render = createResultsRenderer(container);
  try {
    const start = Date.UTC(2026, 10, 12, 12) / 1000;
    const format = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const labels = ['Poll 1', 'Poll 2', 'Poll 3', 'Poll 4'];
    for (const missing of [[], [0], [1], [0, 1], [0, 1, 2]]) {
      const polls = Array.from({ length: 4 }, (_, index) => ({
        options: [
          { text: `Option ${index}`, voters: missing.includes(index) ? ['1'] : ['1', '2'] },
        ],
        votedAt: { 2: index === 3 ? null : start + index * 60 },
      }));
      render(
        groupPolls(identifyPolls(polls), 'poll:2'),
        { 1: 'Explicit participant', 2: 'Flexible participant' },
        identifyPolls(polls),
      );
      const topic = find(container, (node) => node.className === 'group-option')[0];
      const participant = find(topic, (node) => node.textContent === 'Flexible participant')[0];
      participant.emit('click');
      const text = body.children[0].textContent;
      const ordered = [...labels.keys()]
        .filter((index) => missing.includes(index))
        .concat([...labels.keys()].filter((index) => !missing.includes(index)));
      assert.deepEqual(
        text.split('\n'),
        ordered
          .map(
            (index) =>
              `“${labels[index]}” — ${missing.includes(index) ? 'no vote' : index === 3 ? 'time unavailable' : format.format(new Date((start + index * 60) * 1000))}`,
          )
          .concat('Telegram ID: 2'),
      );
      assert.equal(participant.attributes['aria-describedby'], 'personTooltip');
      assert.equal(
        participant.className,
        missing.includes(0) || missing.includes(1) ? 'person implicit' : 'person',
      );
      const attendees = find(container, (node) => node.className === 'group-attendees')[0];
      const dayName = find(attendees, (node) => node.textContent === 'Flexible participant')[0];
      assert.equal(dayName.className, missing.includes(1) ? 'person implicit' : 'person');
      dayName.emit('click');
      assert.equal(body.children[0].textContent, text);
    }
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});
