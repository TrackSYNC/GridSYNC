/* Browser tests for both pages. Run from the repo root with a static server on :8765:
     python3 -m http.server 8765 &
     node tests/e2e.js
   Needs Playwright (npm install). Screenshots go to tests/screenshots/. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const T = require('../assets/schedule-core.js');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
// Serve the March 2026 fixture in place of data/schedule.js so these checks do not depend on the live schedule.
const FIXTURE = path.join(__dirname, 'fixtures', 'march-2026-schedule.js');
const SCHEDULE_URL = /\/data\/schedule\.js(\?.*)?$/;
async function useFixture(ctx) {
  await ctx.route(SCHEDULE_URL, (route) => route.fulfill({ path: FIXTURE, contentType: 'text/javascript' }));
}
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail && !cond ? '  -> ' + detail : ''));
  if (!cond) failures += 1;
}

function watch(page, bucket) {
  page.on('console', (m) => {
    const t = m.text();
    // Expected in CI/sandboxes: missing optional logo file and blocked Google Fonts.
    if (m.type() === 'error' && !/404|ERR_TUNNEL|ERR_NAME|fonts\.g/i.test(t)) bucket.push(t);
  });
  page.on('pageerror', (e) => bucket.push('pageerror: ' + e.message));
}

async function noHScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

(async () => {
  const browser = await chromium.launch();

  /* ---------------- participant ---------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York' });
    await useFixture(ctx);
    const page = await ctx.newPage();
    const errs = [];
    watch(page, errs);
    await page.clock.setFixedTime(new Date('2026-03-07T10:20:00-05:00'));
    await page.goto(BASE + 'index.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    check('participant: live card shows on an event day', await page.isVisible('#liveCard'));
    check('participant: opens on today (Saturday)', (await page.textContent('#dayTitle')) === 'Saturday');
    const onTrack = await page.textContent('#liveGrid .live-box:first-child');
    check('participant: Yellow is on track at 10:20', /Yellow/.test(onTrack) && /15 min left/.test(onTrack), onTrack);
    check('participant: grid marks the current row', (await page.$$('#scheduleBody tr.is-now')).length === 1);
    await page.click('#groupChips [data-group="green"]');
    await page.click('#viewToggle [data-view="list"]');
    const fold = await page.textContent('#scheduleBody .fold-btn');
    check('participant: finished slots fold on an event day', /Show \d+ earlier time slots/.test(fold), fold);
    check('participant: folded rows are hidden', (await page.$$('#scheduleBody .tl-row.is-past')).length === 0);
    await page.click('#scheduleBody .fold-btn');
    check('participant: Show reveals the earlier slots', (await page.$$('#scheduleBody .tl-row.is-past')).length > 0);
    const soloEntries = await page.$$eval('#scheduleBody .entry', (els) => els.map((e) => e.textContent));
    check('participant: Green timeline has 4 track sessions on Saturday', soloEntries.filter((t) => /Track session/.test(t)).length === 4, soloEntries.join(' | '));
    check('participant: URL carries the group', /group=green/.test(page.url()), page.url());
    const mine = await page.textContent('#liveGrid');
    check('participant: Green next session box', /Green: next track session/.test(mine) && /12:30 PM/.test(mine), mine);
    check('participant: stat chip for Green', /4 track sessions/.test(await page.textContent('#dayStats')));
    await page.screenshot({ path: path.join(SHOTS, 'participant-desktop-live.png'), fullPage: true });
    // day switch and no-live day
    await page.click('#dayTabs [data-day="sun"]');
    check('participant: switching day shows a Show Saturday button', await page.isVisible('[data-goto-day="sat"]'));
    // print layout
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    check('participant: print area has all 3 days', (await page.$$('#printArea .print-day')).length === 3);
    await page.screenshot({ path: path.join(SHOTS, 'participant-print.png'), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    check('participant: no JS errors (desktop)', errs.length === 0, errs.join('\n'));
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/New_York' });
    await useFixture(ctx);
    const page = await ctx.newPage();
    const errs = [];
    watch(page, errs);
    await page.goto(BASE + 'index.html?day=sun&group=purple&now=13:20', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    check('participant mobile: defaults to timeline', (await page.getAttribute('#viewToggle [data-view="list"]', 'aria-pressed')) === 'true');
    check('participant mobile: preview chip', /Preview/.test(await page.textContent('#liveChips')));
    check('participant mobile: no horizontal scroll (timeline)', await noHScroll(page));
    await page.screenshot({ path: path.join(SHOTS, 'participant-mobile-timeline.png'), fullPage: true });
    await page.click('#viewToggle [data-view="grid"]');
    check('participant mobile: no horizontal scroll (grid)', await noHScroll(page));
    await page.screenshot({ path: path.join(SHOTS, 'participant-mobile-grid.png'), fullPage: true });
    check('participant: no JS errors (mobile)', errs.length === 0, errs.join('\n'));
    await ctx.close();
  }
  {
    // Folded morning on a phone, then a newly published schedule arrives while the page is open.
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/New_York' });
    await useFixture(ctx);
    const page = await ctx.newPage();
    const errs = [];
    watch(page, errs);
    await page.clock.install({ time: new Date('2026-03-07T10:15:00-05:00') });
    await page.goto(BASE + 'index.html?group=yellow&view=list', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    check('participant fold: Yellow at 10:15 folds 5 slots', (await page.textContent('#scheduleBody .fold-btn')) === 'Show 5 earlier time slots');
    check('participant fold: current slot is first', /10:10\sAM/.test(await page.textContent('#scheduleBody .tl-row')));
    check('participant fold: grid folds too', await (async () => {
      await page.click('#viewToggle [data-view="grid"]');
      const ok = (await page.$$('#scheduleBody tr.fold-row')).length === 1;
      await page.click('#viewToggle [data-view="list"]');
      return ok;
    })());
    await page.evaluate(() => document.getElementById('scheduleCard').scrollIntoView());
    await page.screenshot({ path: path.join(SHOTS, 'participant-mobile-folded.png') });

    await page.clock.runFor(61000);
    check('participant update: no banner when nothing changed', await page.isHidden('#updateBanner'));
    const updated = fs.readFileSync(FIXTURE, 'utf8')
      .replace('"notice": "Times are subject to change', '"notice": "Running 15 minutes late. Times are subject to change');
    await ctx.unroute(SCHEDULE_URL);
    await ctx.route(SCHEDULE_URL, (route) => route.fulfill({ body: updated, contentType: 'text/javascript' }));
    await page.clock.runFor(61000);
    await page.waitForTimeout(300);
    check('participant update: banner shows after a publish', await page.isVisible('#updateBanner'));
    check('participant update: new notice is on the page', /Running 15 minutes late/.test(await page.textContent('#eventNotice')));
    check('participant update: keeps the selected group', (await page.getAttribute('#groupChips [data-group="yellow"]', 'aria-pressed')) === 'true');
    check('participant update: check scripts are cleaned up', (await page.$$('script[src*="check="]')).length === 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, 'participant-mobile-updated.png') });
    await page.click('[data-dismiss-update]');
    check('participant update: Dismiss hides the banner', await page.isHidden('#updateBanner'));
    check('participant update: no JS errors', errs.length === 0, errs.join('\n'));
    await ctx.close();
  }
  {
    // Right Now card shrinks to one line while the track is cold.
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await useFixture(ctx);
    const page = await ctx.newPage();
    const errs = [];
    watch(page, errs);
    const cases = [
      ['05:00', true, /Track cold\. Gates Open at 6:00\sAM\. First session 8:30\sAM, in 3h 30m\. Yellow first on track 10:10\sAM\./],
      ['07:00', false, /Tech\/Registration/],
      ['12:00', false, /Lunch/],
      ['18:00', true, /Track closed for today\. Sunday: .+ at /]
    ];
    for (const [time, slim, text] of cases) {
      await page.goto(BASE + 'index.html?now=2026-03-07T' + time + '&group=yellow&view=list', { waitUntil: 'load' });
      await page.waitForTimeout(200);
      const isSlim = await page.$eval('#liveCard', (c) => c.classList.contains('is-slim'));
      const shown = await page.textContent('#liveGrid');
      check('right now ' + time + ': ' + (slim ? 'slim bar' : 'full card'), isSlim === slim, shown);
      check('right now ' + time + ': text', text.test(shown), shown);
      await page.screenshot({ path: path.join(SHOTS, 'participant-right-now-' + time.replace(':', '') + '.png') });
    }
    await page.goto(BASE + 'index.html?now=2026-03-08T18:00', { waitUntil: 'load' });
    check('right now: last day says the event is over', /That was the last day of the event\./.test(await page.textContent('#liveGrid')));
    check('right now: no JS errors', errs.length === 0, errs.join('\n'));
    await ctx.close();
  }
  {
    // Not an event day: no live card, opens on the first day.
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 } });
    await useFixture(ctx);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2026-09-25T12:00:00-04:00'));
    await page.goto(BASE + 'index.html', { waitUntil: 'load' });
    check('participant: no live card outside event days', await page.isHidden('#liveCard'));
    check('participant: opens on the first day with track sessions', (await page.textContent('#dayTitle')) === 'Saturday');
    await ctx.close();
  }

  /* ---------------- organizer ---------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await useFixture(ctx);
    const page = await ctx.newPage();
    const errs = [];
    watch(page, errs);
    await page.goto(BASE + 'organizer.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    check('organizer: opens on Saturday (first day with track)', (await page.getAttribute('#dayTabs [data-day="sat"]', 'aria-pressed')) === 'true');
    check('organizer: shows 1 error and 1 warning', /1 error, 1 warning/.test(await page.textContent('#statusText')));
    check('organizer: flagged cells outlined', (await page.$$('#gridWrap td.has-issue')).length >= 2);

    // Fix the Saturday conflict: move the Green 12:30 session to 12:45-1:10.
    const greenCell = await page.$('#gridWrap td[data-item="sat-18"]');
    await greenCell.click();
    check('organizer: item modal opens', await page.isVisible('#itemModal.show'));
    await page.fill('#imStart', '12:45');
    await page.fill('#imEnd', '13:00');
    await page.click('#imSave');
    await page.waitForTimeout(100);
    check('organizer: overlap error cleared', /^1 warning$/.test((await page.textContent('#statusText')).trim()), await page.textContent('#statusText'));

    // Add a Yellow session by clicking an empty cell, and a White one via the Add item button.
    const emptyYellow = await page.$('#gridWrap td.empty[data-group="yellow"][data-start="13:00"]');
    check('organizer: empty Yellow cell at 1:00 PM exists', !!emptyYellow);
    await emptyYellow.click();
    check('organizer: add modal preselects Yellow', await page.isChecked('#imGroups input[value="yellow"]'));
    check('organizer: add modal presets the row time', (await page.inputValue('#imStart')) === '13:00');
    await page.fill('#imStart', '17:30');
    await page.fill('#imEnd', '17:55');
    await page.click('#imSave');
    await page.click('[data-action="add-item"]');
    await page.fill('#imStart', '17:55');
    await page.fill('#imEnd', '18:20');
    await page.check('#imGroups input[value="white"]', { force: true });
    await page.click('#imSave');
    await page.waitForTimeout(100);
    check('organizer: Saturday is now clean', /No conflicts/.test(await page.textContent('#statusText')), await page.textContent('#statusText'));

    // Undo / redo
    await page.click('#undoBtn');
    check('organizer: undo brings the warning back', /1 warning/.test(await page.textContent('#statusText')));
    await page.click('#redoBtn');
    check('organizer: redo clears it again', /No conflicts/.test(await page.textContent('#statusText')));

    // Shift: push Sunday afternoon 10 minutes later.
    await page.click('#dayTabs [data-day="sun"]');
    await page.click('[data-action="shift"]');
    await page.fill('#shiftFrom', '12:45');
    await page.fill('#shiftBy', '10');
    const shiftPreview = await page.textContent('#shiftPreview');
    check('organizer: shift preview counts items', /Moves 15 items later by 10 min/.test(shiftPreview), shiftPreview);
    await page.click('#shiftApply');
    const sunLunchConflict = await page.textContent('#statusText');
    check('organizer: shift keeps Sunday clean', /No conflicts/.test(sunLunchConflict), sunLunchConflict);

    // Rotation on a new day.
    await page.click('[data-action="add-day"]');
    check('organizer: new day is Monday 3/9', /Monday/.test(await page.textContent('#dayTabs [aria-pressed="true"]')));
    await page.click('[data-action="rotation"]');
    await page.fill('#rotStart', '09:00');
    await page.fill('#rotCount', '10');
    await page.fill('#rotLen', '20');
    const rotPreview = await page.textContent('#rotPreview');
    check('organizer: rotation preview', /Adds 10 track sessions from 9:00 AM to 12:20 PM/.test(rotPreview), rotPreview);
    await page.click('#rotApply');
    check('organizer: rotation added 10 cells', (await page.$$('#gridWrap td.k-track')).length === 10);
    await page.screenshot({ path: path.join(SHOTS, 'organizer-rotation.png'), fullPage: true });

    // Group edits: rename and recolor Blue, then remove and undo.
    await page.fill('#gn-blue', 'Blue Team');
    await page.press('#gn-blue', 'Tab');
    check('organizer: group rename shows in grid header', /BLUE TEAM/i.test(await page.textContent('#gridWrap thead')));
    await page.click('.group-row[data-gid="purple"] [data-gremove]');
    check('organizer: remove group asks first', await page.isVisible('#confirmModal.show'));
    await page.click('#confirmOk');
    check('organizer: purple column gone', !/PURPLE/i.test(await page.textContent('#gridWrap thead')));
    await page.keyboard.press('Control+z');
    check('organizer: Ctrl+Z restores purple', /PURPLE/i.test(await page.textContent('#gridWrap thead')));

    // Draft survives a reload.
    await page.reload({ waitUntil: 'load' });
    check('organizer: draft banner after reload', await page.isVisible('#draftBanner'));
    check('organizer: draft kept the new day', (await page.$$('#dayTabs [data-day]')).length === 4);

    // Export and parse the file back.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.bottom-bar [data-action="export"]')]);
    const file = path.join(SHOTS, 'exported-schedule.js');
    await dl.saveAs(file);
    check('organizer: download is named schedule.js', dl.suggestedFilename() === 'schedule.js');
    const round = T.parseScheduleText(fs.readFileSync(file, 'utf8'));
    check('organizer: exported file parses', round.days.length === 4 && round.groups.length === 5);
    check('organizer: exported file has no errors', T.validate(round).filter((i) => i.severity === 'error').length === 0,
      JSON.stringify(T.validate(round)));

    // Preview the draft in the participant page.
    const [preview] = await Promise.all([ctx.waitForEvent('page'), page.click('.bottom-bar [data-action="preview"]')]);
    await preview.waitForLoadState('load');
    check('organizer: preview shows draft banner', await preview.isVisible('#draftBanner'));
    check('organizer: preview shows the new Monday tab', /Monday/.test(await preview.textContent('#dayTabs')));
    await preview.close();

    // Discard draft returns to the published file.
    await page.click('#publishCard [data-action="discard"]');
    await page.click('#confirmOk');
    check('organizer: discard returns to published (3 days)', (await page.$$('#dayTabs [data-day]')).length === 3);
    check('organizer: discard restores the published issues', /1 error, 1 warning/.test(await page.textContent('#statusText')));

    // Load the exported file back in.
    await page.setInputFiles('#fileInput', file);
    await page.click('#confirmOk');
    check('organizer: load file restores 4 days', (await page.$$('#dayTabs [data-day]')).length === 4);

    // Export with errors asks first.
    await page.click('#publishCard [data-action="discard"]');
    await page.click('#confirmOk');
    await page.click('.bottom-bar [data-action="export"]');
    check('organizer: export with errors asks first', /Export with 1 error/.test(await page.textContent('#confirmTitle')));
    await page.click('#confirmModal [data-close]');

    check('organizer: no JS errors', errs.length === 0, errs.join('\n'));
    await page.screenshot({ path: path.join(SHOTS, 'organizer-desktop.png'), fullPage: true });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await useFixture(ctx);
    const page = await ctx.newPage();
    const errs = [];
    watch(page, errs);
    await page.goto(BASE + 'organizer.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    check('organizer mobile: no horizontal scroll', await noHScroll(page));
    await page.screenshot({ path: path.join(SHOTS, 'organizer-mobile.png'), fullPage: true });
    await page.click('#gridWrap td[data-item="sat-18"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'organizer-mobile-modal.png') });
    check('organizer mobile: no JS errors', errs.length === 0, errs.join('\n'));
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? '\n' + failures + ' check(s) failed' : '\nAll browser checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
