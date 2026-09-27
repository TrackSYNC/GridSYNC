/* Unit tests for assets/schedule-core.js. Run with: node --test tests/core.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const T = require('../assets/schedule-core.js');

// Fixed copy of the March 2026 conversion, so data/schedule.js can change per event without breaking tests.
const sample = T.parseScheduleText(fs.readFileSync(path.join(__dirname, 'fixtures', 'march-2026-schedule.js'), 'utf8'));

function mini(items, groups) {
  return T.normalize({
    event: { name: 'Test' },
    groups: groups || [
      { id: 'green', name: 'Green', color: '#538135' },
      { id: 'blue', name: 'Blue', color: '#2E74B5' }
    ],
    days: [{ id: 'sat', label: 'Saturday', date: '2026-03-07', items: items }]
  });
}

test('time parsing and formatting', () => {
  assert.equal(T.parseTime('08:30'), 510);
  assert.equal(T.parseTime('8:05'), 485);
  assert.equal(T.parseTime(''), null);
  assert.ok(Number.isNaN(T.parseTime('25:00')));
  assert.ok(Number.isNaN(T.parseTime('noon')));
  assert.equal(T.toHHMM(765), '12:45');
  assert.equal(T.fmtTime(765), '12:45 PM');
  assert.equal(T.fmtTime(0), '12:00 AM');
  assert.equal(T.fmtRange(585, 610).text, '9:45–10:10 AM');
  assert.equal(T.fmtRange(705, 765).text, '11:45 AM–12:45 PM');
  assert.equal(T.fmtDuration(100), '1h 40m');
  assert.equal(T.fmtDuration(25), '25 min');
  assert.equal(T.fmtDateSpan(sample.days), 'Fri, Mar 6 – Sun, Mar 8, 2026');
});

test('nowInZone reads the track time zone', () => {
  const at = new Date('2026-03-07T15:20:00Z'); // 10:20 AM EST
  assert.deepEqual(T.nowInZone('America/New_York', at), { date: '2026-03-07', minutes: 620 });
  const summer = new Date('2026-07-04T00:30:00Z'); // 8:30 PM EDT on July 3
  assert.deepEqual(T.nowInZone('America/New_York', summer), { date: '2026-07-03', minutes: 1230 });
});

test('text color picks the higher contrast option', () => {
  assert.equal(T.textOn('#538135'), '#FFFFFF');
  assert.equal(T.textOn('#FFC000'), '#15181D');
  assert.equal(T.textOn('#7030A0'), '#FFFFFF');
});

test('sample data converted from the March 2026 sheet', () => {
  assert.equal(sample.event.name, 'Oak Tree Bowl VI HPDE');
  assert.deepEqual(sample.groups.map((g) => g.id), ['white', 'green', 'yellow', 'purple', 'blue']);
  assert.deepEqual(sample.days.map((d) => [d.id, d.items.length]), [['fri', 2], ['sat', 28], ['sun', 32]]);
  const sun = T.trackSummary(T.dayById(sample, 'sun'), sample);
  for (const g of sample.groups) assert.equal(sun[g.id].sessions, 4, g.id);
  const meeting = T.dayById(sample, 'sat').items.find((i) => i.title === 'Instructor Meeting');
  assert.deepEqual(meeting.groups, ['white']);
});

test('validator finds the Saturday problems in the source sheet', () => {
  const issues = T.validate(sample);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].dayId, 'sat');
  assert.match(errors[0].message, /^Green is double-booked\. Track \(12:30–1:00 PM\) overlaps Lunch/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /White has 3 and Yellow has 3\. The other groups have 4\./);
  assert.equal(issues.filter((i) => i.dayId === 'sun').length, 0);
});

test('validator: two groups on track at once', () => {
  const d = mini([
    { id: 'a', start: '09:00', end: '09:25', kind: 'track', groups: ['green'] },
    { id: 'b', start: '09:20', end: '09:45', kind: 'track', groups: ['blue'] }
  ]);
  const errs = T.validate(d).filter((i) => i.severity === 'error');
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /^Two sessions on track at once\. Blue Track/);
  assert.deepEqual(errs[0].itemIds.sort(), ['a', 'b']);
});

test('validator: touching sessions and classroom beside track are fine', () => {
  const d = mini([
    { id: 'a', start: '09:00', end: '09:25', kind: 'track', groups: ['green'] },
    { id: 'b', start: '09:25', end: '09:50', kind: 'track', groups: ['blue'] },
    { id: 'c', start: '09:25', end: '09:50', kind: 'classroom', groups: ['green'] }
  ]);
  assert.equal(T.validate(d).length, 0);
});

test('validator: bad times and missing groups', () => {
  const d = mini([
    { id: 'a', start: '10:00', end: '09:00', kind: 'track', groups: ['green'] },
    { id: 'b', start: 'soon', end: '', kind: 'meeting', groups: 'all' },
    { id: 'c', start: '11:00', end: '11:20', kind: 'classroom', groups: [] },
    { id: 'd', start: '12:00', end: '', kind: 'track', groups: ['blue'] }
  ]);
  const msgs = T.validate(d).map((i) => i.severity + ': ' + i.message);
  assert.ok(msgs.some((m) => /error: Track ends at 9:00 AM, before it starts at 10:00 AM/.test(m)), msgs.join('\n'));
  assert.ok(msgs.some((m) => /error: Meeting has no valid start time/.test(m)));
  assert.ok(msgs.some((m) => /error: Classroom at 11:00 AM is not assigned to a run group/.test(m)));
  assert.ok(msgs.some((m) => /warning: Track session at 12:00 PM has no end time/.test(m)));
});

test('normalize cleans input and keeps ids stable', () => {
  const d = T.normalize({
    groups: [{ id: 'Green', name: 'Green', color: 'abc' }, { name: 'Green' }],
    days: [{ label: 'Sat', date: '2026-02-30', items: [
      { id: 'x', start: '9:05', end: '9:30', kind: 'nope', groups: ['green', 'ghost', 'green'] },
      { id: 'x', start: '8:00', end: '8:10', kind: 'track', groups: 'all' }
    ] }]
  });
  assert.deepEqual(d.groups.map((g) => g.id), ['green', 'green-2']);
  assert.equal(d.groups[0].color, '#AABBCC');
  assert.equal(d.days[0].date, '', 'invalid calendar date dropped');
  const [first, second] = d.days[0].items;
  assert.equal(first.start, '08:00', 'items sorted by start');
  assert.equal(second.kind, 'general', 'unknown kind becomes general');
  assert.deepEqual(second.groups, ['green'], 'unknown and duplicate group refs dropped');
  assert.notEqual(first.id, second.id, 'duplicate item ids replaced');
});

test('grid rows merge multi-group cells and split conflicts into lanes', () => {
  const sat = T.dayById(sample, 'sat');
  const built = T.buildRows(sat, sample, true);
  const meetup = built.rows.find((r) => r.start === 510);
  const cells = T.rowCells(meetup, sample);
  assert.deepEqual(cells.map((c) => [c.span, c.item && c.item.kind]), [[3, 'meeting'], [1, 'classroom'], [1, 'track']]);
  const clash = mini([
    { id: 'a', start: '09:00', end: '09:25', kind: 'track', groups: ['green'] },
    { id: 'b', start: '09:00', end: '09:25', kind: 'classroom', groups: ['green'] }
  ]);
  assert.equal(T.buildRows(clash.days[0], clash, true).rows.length, 2);
  assert.equal(T.buildRows(clash.days[0], clash, false).rows.length, 1);
});

test('live info at 10:20 on Saturday', () => {
  const sat = T.dayById(sample, 'sat');
  const info = T.liveInfo(sample, sat, 620, null);
  assert.deepEqual(info.onTrack.groups, ['yellow']);
  assert.deepEqual(info.nextTrack.groups, ['blue']);
  const green = T.liveInfo(sample, sat, 620, 'green');
  assert.equal(green.nextGroupTrack.start, '12:30');
  assert.equal(T.liveInfo(sample, sat, 18 * 60, null).dayOver, true);
});

test('rotation skips lunch and existing sessions', () => {
  const d = mini([
    { id: 'l', start: '11:45', end: '12:45', kind: 'break', groups: 'all', title: 'Lunch' },
    { id: 't', start: '13:10', end: '13:35', kind: 'track', groups: ['blue'] }
  ]);
  const plan = T.planRotation(d.days[0], d, { start: 11 * 60 + 30, length: 25, gap: 0, count: 3, order: ['green', 'blue'], avoid: true });
  assert.deepEqual(plan.map((p) => [T.toHHMM(p.start), p.group]), [['12:45', 'green'], ['13:35', 'blue'], ['14:00', 'green']]);
  const raw = T.planRotation(d.days[0], d, { start: 11 * 60 + 30, length: 25, gap: 5, count: 2, order: ['green'], avoid: false });
  assert.deepEqual(raw.map((p) => T.toHHMM(p.start)), ['11:30', '12:00']);
});

test('schedule.js export round-trips', () => {
  const text = T.toScheduleJs(sample);
  assert.match(text, /^\/\* TSCC HPDE schedule data/);
  assert.match(text, /window\.TSCC_SCHEDULE = \{/);
  const back = T.parseScheduleText(text);
  const strip = (d) => JSON.stringify(Object.assign({}, d, { updatedAt: '' }));
  assert.equal(strip(back), strip(sample));
  assert.throws(() => T.parseScheduleText('hello'), /No schedule data/);
  assert.throws(() => T.parseScheduleText('{"a":1}'), /not a TSCC schedule/);
});

test('rendered HTML escapes user text', () => {
  const d = mini([{ id: 'a', start: '09:00', end: '09:30', kind: 'meeting', groups: 'all', title: '<img src=x onerror=alert(1)>' }]);
  const grid = T.renderGrid(d, d.days[0], {}).html;
  const list = T.renderTimeline(d, d.days[0], {});
  assert.ok(!grid.includes('<img'), 'grid escaped');
  assert.ok(!list.includes('<img'), 'timeline escaped');
});
