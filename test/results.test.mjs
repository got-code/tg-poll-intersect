import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDate, filterTopics } from '../src/domain/polls.mjs';
import { demo } from '../src/demo.mjs';
import { createResultsRenderer } from '../src/ui/results.mjs';

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.className = ''; this.textContent = '';
    this.hidden = false; this.style = {}; this.attributes = {}; this.handlers = {};
    this.offsetWidth = 188; this.offsetHeight = 32;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  getBoundingClientRect() { return {left:280, top:50, bottom:70}; }
  emit(type, event = {}) {
    if (type === 'focus') document.activeElement = this;
    if (type === 'blur') document.activeElement = null;
    this.handlers[type]?.(event);
  }
}
function find(node, predicate) { return [...(predicate(node) ? [node] : []), ...node.children.flatMap(child => find(child, predicate))]; }

test('date cards expose every name/count in topic-time-place order; IDs appear only in a dismissible tooltip', () => {
  const body = new Element('body');
  const docEvents = {}, windowEvents = {};
  globalThis.document = { createElement:tag => new Element(tag), body, addEventListener:(type, handler) => { docEvents[type] = handler; } };
  globalThis.window = { innerWidth:320, innerHeight:640, addEventListener:(type, handler) => { windowEvents[type] = handler; } };
  globalThis.requestAnimationFrame = callback => callback();
  const container = new Element('main');
  const render = createResultsRenderer(container);
  const data = demo();
  render(groupByDate(data.polls), data.names);
  assert.equal(container.children.length, 2);
  assert.deepEqual(find(container.children[0], el => el.tag === 'h4').map(el => el.textContent), ['Topics','Time','Places']);
  assert.equal(find(container, el => el.className === 'date-option').length, 12);
  assert.deepEqual(find(container, el => el.className === 'date-count').map(el => el.textContent), ['Day: 4','Day: 4']);
  assert.deepEqual(find(container, el => el.className === 'best-topic-count').map(el => el.textContent), ['Top topic: 3','Top topic: 3']);
  assert.equal(find(container, el => el.className === 'option-count')[0].textContent, '3');
  const buttons = find(container, el => el.className === 'person');
  assert.ok(buttons.length > 8);
  assert.ok(buttons.every(button => Object.values(data.names).includes(button.textContent)));
  assert.equal(find(container, el => /Telegram ID|user:/.test(el.textContent)).length, 0);

  const vasya = buttons.find(button => button.textContent === 'Alex');
  vasya.emit('click');
  const tooltip = body.children[0];
  assert.equal(tooltip.textContent, 'Telegram ID: 1');
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.style.left, '124px'); // Clamped to the narrow screen.
  assert.equal(vasya.attributes['aria-describedby'], 'personTooltip');
  docEvents.keydown({key:'Escape'});
  assert.equal(tooltip.hidden, true);
  assert.equal(vasya.attributes['aria-describedby'], undefined);
  vasya.emit('mouseenter');
  assert.equal(tooltip.hidden, false);
  vasya.emit('mouseleave');
  assert.equal(tooltip.hidden, true);
  vasya.emit('focus');
  assert.equal(tooltip.hidden, false);
  docEvents.pointerdown({target:container});
  assert.equal(tooltip.hidden, true);
  vasya.emit('click');
  render([], {});
  assert.equal(container.children.length, 0);
  assert.equal(tooltip.hidden, true);
  render(filterTopics(groupByDate(data.polls), 3), data.names);
  assert.equal(find(container, el => el.className === 'date-option').length, 10);
  render(filterTopics(groupByDate(data.polls), 4), data.names);
  assert.equal(container.children.length, 0);
  // Sasha did not answer the topic poll; totals and names distinguish this case.
  data.polls[0].options[0].voters = ['1','2'];
  const flexible = groupByDate(data.polls);
  render(flexible, data.names);
  assert.deepEqual(find(container, el => el.className === 'best-topic-count').map(el => el.textContent), ['Top topic: 2(+1?)','Top topic: 3(+1?)']);
  const implicit = find(container, el => el.className === 'person implicit');
  assert.ok(implicit.length > 0);
  assert.ok(implicit.every(button => button.textContent === 'Sam'));
  assert.ok(implicit.every(button => /no vote/.test(button.attributes['aria-label'])));
  const count = find(container, el => el.className === 'option-count')[0];
  assert.equal(count.textContent, '2(+1?)');
  count.emit('click');
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /Implicit: 1/);
  assert.match(tooltip.textContent, /no vote in Date or Topic/);
  assert.match(tooltip.textContent, /Total: 3/);
  for (const row of find(container, el => el.className === 'date-option')) {
    const names = find(row, el => el.className === 'person' || el.className === 'person implicit');
    const firstImplicit = names.findIndex(el => el.className === 'person implicit');
    if (firstImplicit >= 0) assert.ok(names.slice(firstImplicit).every(el => el.className === 'person implicit'));
  }
  const lastTopic = find(container.children[1], el => el.className === 'date-option')[0];
  assert.deepEqual(find(lastTopic, el => el.className === 'person' || el.className === 'person implicit').map(el => el.textContent), ['Anna','Pat','Chris','Sam']);
  const missingDate = demo();
  missingDate.polls[1].options[1].voters = ['3','4','6'];
  render(groupByDate(missingDate.polls), missingDate.names);
  assert.deepEqual(find(container, el => el.className === 'date-count').map(el => el.textContent), ['Day: 4(+1?)','Day: 3(+1?)']);
  const datePeople = find(container.children[0], el => el.className === 'date-attendees')[0];
  const dayNames = find(datePeople, el => el.className === 'person' || el.className === 'person implicit');
  assert.equal(dayNames.at(-1).textContent, 'Pat');
  assert.equal(dayNames.at(-1).className, 'person implicit');
  const dayCount = find(container, el => el.className === 'date-count')[0];
  dayCount.emit('click');
  assert.match(tooltip.textContent, /no vote in Date/);
  assert.match(tooltip.textContent, /Total: 5/);
  const inferredTime = find(container.children[0], el => el.className === 'date-option').find(row => row.children[0].textContent === '18:00');
  assert.equal(find(inferredTime, el => el.className === 'option-count')[0].textContent, '3(+1?)');
  delete globalThis.document; delete globalThis.window; delete globalThis.requestAnimationFrame;
});

test('implicit tooltips list the missing polls first and all explicit polls afterwards', () => {
  const body = new Element('body');
  globalThis.document = { createElement: tag => new Element(tag), body, addEventListener() {} };
  globalThis.window = { innerWidth: 390, innerHeight: 844, addEventListener() {} };
  const container = new Element('main');
  const render = createResultsRenderer(container);
  try {
    for (const missing of [[0], [1], [0, 1], [0, 1, 2]]) {
      const polls = Array.from({ length: 4 }, (_, index) => ({ options: [
        { text: `Option ${index}`, voters: missing.includes(index) ? ['1'] : ['1', '2'] },
      ] }));
      render(groupByDate(polls), { '1': 'Explicit participant', '2': 'Flexible participant' });
      const topic = find(container, node => node.className === 'date-option')[0];
      const participant = find(topic, node => node.className === 'person implicit')[0];
      participant.emit('click');
      const text = body.children[0].textContent;
      const assumed = [1, 0].filter(index => missing.includes(index)).map(index => ['Topic', 'Date'][index]).join(', ');
      assert.ok(text.startsWith(`Implicit here: ${assumed} — no vote; all options assumed.`));
      assert.ok(text.indexOf('Explicit votes:') > text.indexOf('Implicit here:'));
      assert.match(text, /Telegram ID: 2/);
      assert.equal(participant.attributes['aria-label'], `Flexible participant. ${text}`);
      for (const [index, label] of ['Topic', 'Date', 'Time', 'Place'].entries()) {
        const explicitLine = text.split('\n').find(line => line.startsWith('Explicit votes:'));
        assert.equal(explicitLine.includes(label), !missing.includes(index));
      }
      if (missing.includes(2)) assert.match(text, /Other implicit polls: Time — no vote/);
    }
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});
