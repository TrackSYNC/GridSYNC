/* TSCC HPDE Scheduler: participant view (index.html).
   Read-only. Reads window.TSCC_SCHEDULE from data/schedule.js.
   URL parameters:
     ?group=green        open with a run group selected (id or name)
     ?day=sat            open a specific day (id or label)
     ?view=grid|list     start in grid or timeline view
     ?now=10:05          preview the live card at a time on the shown day
     ?now=2026-03-07T10:05  preview a specific date and time
     ?draft=1            show the organizer's unpublished draft from this browser */
(function () {
  'use strict';

  var T = window.TSCC;
  var $ = function (id) { return document.getElementById(id); };
  var esc = T.esc;
  var params = new URLSearchParams(window.location.search);
  var prefs = T.store.get(T.PREFS_KEY) || {};

  var raw = window.TSCC_SCHEDULE;
  var draft = null;
  if (params.get('draft') === '1') {
    var saved = T.store.get(T.DRAFT_KEY);
    if (saved && saved.data) { raw = saved.data; draft = saved; }
  }
  if (!raw) {
    fatal('The schedule file did not load. Keep the data and assets folders next to index.html, then reload.');
    return;
  }
  var data = T.normalize(raw);
  if (!data.days.length) {
    fatal('The schedule has no days yet.');
    return;
  }

  var preview = parsePreview(params.get('now'));
  var state = {
    day: null,
    dayAuto: true,
    group: pickGroup(params.get('group')) || pickGroup(prefs.group) || 'all',
    view: pickView()
  };
  pickInitialDay();

  /* --------------------------------------------------------- selection */

  function findDay(v) {
    if (!v) return null;
    v = String(v).toLowerCase();
    for (var i = 0; i < data.days.length; i++) {
      var d = data.days[i];
      if (d.id === v || d.label.toLowerCase() === v || d.label.toLowerCase().indexOf(v) === 0 || d.date === v) return d;
    }
    return null;
  }
  function pickGroup(v) {
    if (!v) return null;
    if (v === 'all') return 'all';
    v = String(v).toLowerCase();
    for (var i = 0; i < data.groups.length; i++) {
      var g = data.groups[i];
      if (g.id === v || g.name.toLowerCase() === v || T.slug(g.name) === v || (g.level && g.level.toLowerCase() === v)) return g.id;
    }
    return null;
  }
  function pickView() {
    var v = params.get('view') || prefs.view;
    if (v === 'grid' || v === 'list') return v;
    return window.innerWidth >= 760 ? 'grid' : 'list';
  }
  function pickInitialDay() {
    var fromUrl = findDay(params.get('day'));
    if (preview && preview.date) {
      var d = findDay(preview.date);
      if (d) { state.day = d.id; state.dayAuto = false; return; }
    }
    if (fromUrl) { state.day = fromUrl.id; state.dayAuto = false; return; }
    var live = liveContext();
    var firstTrackDay = data.days.filter(T.dayHasTrack)[0] || data.days[0];
    state.day = live ? live.dayId : firstTrackDay.id;
  }
  function parsePreview(v) {
    if (!v) return null;
    var m = /^(?:(\d{4}-\d{2}-\d{2})[T ])?(\d{1,2}:\d{2})$/.exec(v.trim());
    if (!m) return null;
    var minutes = T.parseTime(m[2]);
    return T.isNum(minutes) ? { date: m[1] || null, minutes: minutes } : null;
  }

  // Which day is live, and the minute of that day. Null when no event day is today.
  function liveContext() {
    if (preview) {
      var pd = preview.date ? findDay(preview.date) : T.dayById(data, state.day) || data.days[0];
      return pd ? { dayId: pd.id, minutes: preview.minutes, preview: true } : null;
    }
    var now = T.nowInZone(data.event.timezone);
    for (var i = 0; i < data.days.length; i++) {
      if (data.days[i].date === now.date) return { dayId: data.days[i].id, minutes: now.minutes, preview: false };
    }
    return null;
  }

  /* ------------------------------------------------------------ render */

  function renderHeader() {
    document.title = data.event.name + ' · Schedule';
    $('eventName').textContent = data.event.name;
    var meta = [data.event.track, T.fmtDateSpan(data.days)].filter(Boolean);
    $('eventMeta').innerHTML = meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('');
    if (data.event.notice) {
      $('eventNotice').textContent = data.event.notice;
      $('eventNotice').hidden = false;
    }
    if (draft) {
      $('draftBanner').textContent = 'Draft preview from the organizer page' +
        (draft.savedAt ? ', saved ' + T.fmtStamp(draft.savedAt) : '') +
        '. Participants do not see this version until it is published.';
      $('draftBanner').hidden = false;
    }
    $('footNotice').textContent = 'Times are track local time (' + data.event.timezone.replace(/_/g, ' ') +
      '). This page updates when the organizers publish a change.';
    var stamp = T.fmtStamp(data.updatedAt);
    $('footMeta').textContent = stamp ? 'Schedule last published ' + stamp + '.' : '';
  }

  function renderControls() {
    $('dayTabs').innerHTML = data.days.map(function (d) {
      return '<button type="button" data-day="' + esc(d.id) + '" aria-pressed="' + (d.id === state.day) + '">' +
        esc(d.label) + (d.date ? '<span class="seg-sub">' + esc(T.fmtDateShort(d.date)) + '</span>' : '') + '</button>';
    }).join('');
    var chips = '<button type="button" class="chip" data-group="all" aria-pressed="' + (state.group === 'all') + '">' +
      '<span class="sw all"></span>All groups</button>';
    chips += data.groups.map(function (g) {
      return '<button type="button" class="chip" data-group="' + esc(g.id) + '" aria-pressed="' + (state.group === g.id) + '">' +
        '<span class="sw" style="--c:' + g.color + '"></span>' + esc(g.name) +
        (g.level ? ' <span class="lvl">' + esc(g.level) + '</span>' : '') + '</button>';
    }).join('');
    $('groupChips').innerHTML = chips;
    Array.prototype.forEach.call($('viewToggle').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === state.view));
    });
  }

  function swatches(ids) {
    return ids.map(function (id) {
      var g = T.groupById(data, id);
      return g ? '<span class="sw sq" style="--c:' + g.color + '"></span>' : '';
    }).join('');
  }

  function liveBox(eyebrow, main, sub, style) {
    return '<div class="live-box' + (style ? ' hot' : '') + '"' + (style ? ' style="' + style + '"' : '') + '>' +
      '<span class="eyebrow">' + esc(eyebrow) + '</span><div class="live-main">' + main + '</div>' +
      (sub ? '<div class="live-sub">' + sub + '</div>' : '') + '</div>';
  }

  function renderLive(live) {
    var card = $('liveCard');
    if (!live) { card.hidden = true; return; }
    var day = T.dayById(data, live.dayId);
    var m = live.minutes;
    var info = T.liveInfo(data, day, m, null);
    var boxes = [];

    if (info.onTrack) {
      var ids = T.itemGroupIds(info.onTrack, data);
      var end = T.parseTime(info.onTrack.end);
      boxes.push(liveBox('On track now', esc(T.groupNames(ids, data)),
        esc(T.fmtRange(T.parseTime(info.onTrack.start), end).text) + ' &middot; <b class="clock">' + esc(T.fmtDuration(end - m)) + ' left</b>',
        T.paint(info.onTrack, ids, data)));
    } else {
      var everyone = info.active.filter(function (it) { return it.groups === 'all'; })[0];
      if (everyone) {
        var eEnd = T.parseTime(everyone.end);
        boxes.push(liveBox('Happening now', esc(T.itemLabel(everyone)),
          'Until ' + esc(T.fmtTime(eEnd)) + (everyone.location ? ' &middot; ' + esc(everyone.location) : '')));
      } else if (info.dayOver) {
        boxes.push(liveBox('Track', 'Done for today', 'Nothing else is scheduled on ' + esc(day.label) + '.'));
      } else {
        boxes.push(liveBox('On track now', 'No session', info.nextTrack
          ? 'Next session ' + esc(T.fmtUntil(T.parseTime(info.nextTrack.start) - m)) + '.' : ''));
      }
    }

    if (info.nextTrack) {
      var nIds = T.itemGroupIds(info.nextTrack, data);
      var nStart = T.parseTime(info.nextTrack.start);
      boxes.push(liveBox('Next on track', swatches(nIds.slice(0, 1)) + esc(T.groupNames(nIds, data)),
        esc(T.fmtTime(nStart)) + ' &middot; <b class="clock">' + esc(T.fmtUntil(nStart - m)) + '</b>'));
    }

    var mineBoxes = [];
    if (state.group !== 'all') {
      var g = T.groupById(data, state.group);
      var mine = T.liveInfo(data, day, m, state.group);
      var current = mine.active[0];
      if (current && current.kind === 'track') {
        var cEnd = T.parseTime(current.end);
        mineBoxes.push(liveBox(g.name + ' right now', 'On track', '<b class="clock">' + esc(T.fmtDuration(cEnd - m)) + ' left</b>',
          T.paint(current, [g.id], data)));
      } else if (current && current.groups !== 'all') {
        mineBoxes.push(liveBox(g.name + ' right now', esc(T.itemLabel(current)),
          'Until ' + esc(T.fmtTime(T.parseTime(current.end))) + (current.location ? ' &middot; ' + esc(current.location) : '')));
      }
      if (mine.nextGroupTrack) {
        var gStart = T.parseTime(mine.nextGroupTrack.start);
        var before = mine.next && mine.next !== mine.nextGroupTrack && T.parseTime(mine.next.start) < gStart ? mine.next : null;
        mineBoxes.push(liveBox(g.name + ': next track session', '<span class="clock">' + esc(T.fmtTime(gStart)) + '</span>',
          '<b class="clock">' + esc(T.fmtUntil(gStart - m)) + '</b>' +
          (before ? '<br>Before that: ' + esc(T.itemLabel(before)) + ', ' + esc(T.fmtTime(T.parseTime(before.start))) : '')));
      } else if (!current || current.kind !== 'track') {
        var nextAny = mine.next;
        mineBoxes.push(liveBox(g.name, 'No more track sessions today', nextAny
          ? 'Next: ' + esc(T.itemLabel(nextAny)) + ', ' + esc(T.fmtTime(T.parseTime(nextAny.start))) : ''));
      }
    }

    $('liveGrid').innerHTML = mineBoxes.concat(boxes).join('');
    $('liveSub').textContent = day.label + (day.date ? ', ' + T.fmtMonthDay(day.date) : '') + ' at ' + T.fmtTime(m) +
      (live.preview ? ' (preview time from the link)' : '');
    var chips = live.preview ? '<span class="warnchip">Preview</span>' : '<span class="editchip">Live</span>';
    if (state.day !== live.dayId) {
      chips += '<button type="button" class="btn btn-secondary btn-sm" data-goto-day="' + esc(live.dayId) + '">Show ' + esc(day.label) + '</button>';
    }
    $('liveChips').innerHTML = chips;
    card.hidden = false;
  }

  function renderSchedule(liveMinutes) {
    var day = T.dayById(data, state.day);
    $('dayTitle').textContent = day.label;
    $('daySub').textContent = day.date ? T.fmtMonthDay(day.date, true) : '';
    var stats = '';
    if (T.dayHasTrack(day)) {
      var sum = T.trackSummary(day, data);
      if (state.group !== 'all') {
        var s = sum[state.group];
        stats = '<span class="stat">' + s.sessions + ' track session' + (s.sessions === 1 ? '' : 's') +
          (s.minutes ? ' &middot; ' + esc(T.fmtDuration(s.minutes)) : '') + '</span>';
      } else {
        var counts = data.groups.map(function (g) { return sum[g.id].sessions; });
        if (counts.length && counts.every(function (c) { return c === counts[0]; })) {
          stats = '<span class="stat">' + counts[0] + ' track sessions per group</span>';
        }
      }
    }
    $('dayStats').innerHTML = stats;
    var body = $('scheduleBody');
    if (state.view === 'grid') {
      body.innerHTML = '<div class="grid-wrap">' + T.renderGrid(data, day, { highlightGroup: state.group, liveMinutes: liveMinutes }).html + '</div>' +
        '<p class="scroll-hint">Swipe the grid sideways to see every group.</p>';
    } else {
      body.innerHTML = T.renderTimeline(data, day, { group: state.group, liveMinutes: liveMinutes });
    }
    $('legend').hidden = state.view !== 'grid';
    var wrap = body.querySelector('.grid-wrap'), hlHead = wrap && wrap.querySelector('thead th.hl');
    if (hlHead && wrap.scrollWidth > wrap.clientWidth) {
      wrap.scrollLeft = Math.max(0, hlHead.offsetLeft - (wrap.clientWidth - hlHead.offsetWidth) / 2);
    }
  }

  function render() {
    var live = liveContext();
    if (live && state.dayAuto && !preview && state.day !== live.dayId) state.day = live.dayId;
    renderControls();
    renderLive(live);
    renderSchedule(live && live.dayId === state.day ? live.minutes : null);
    T.store.set(T.PREFS_KEY, { group: state.group, view: state.view });
    syncUrl();
  }

  function syncUrl() {
    try {
      var p = new URLSearchParams(window.location.search);
      var g = state.group !== 'all' ? T.groupById(data, state.group) : null;
      if (g) p.set('group', T.slug(g.name)); else p.delete('group');
      var q = p.toString();
      window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
    } catch (e) { /* file:// or sandboxed frames */ }
  }

  function printAll() {
    $('printArea').innerHTML = data.days.map(function (d) {
      return '<section class="print-day"><h2>' + esc(d.label) + (d.date ? ' · ' + esc(T.fmtMonthDay(d.date, true)) : '') + '</h2>' +
        T.renderGrid(data, d, {}).html + '</section>';
    }).join('');
    document.body.classList.add('printing');
  }

  function fatal(msg) {
    var main = document.getElementById('main');
    if (main) {
      main.innerHTML = '<section class="card"><div class="section-head"><h2 class="sec-title">Schedule not available</h2>' +
        '<span class="lockchip">Error</span></div><p class="note-box">' + T.esc(msg) + '</p></section>';
    }
  }

  /* ------------------------------------------------------------ events */

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-day],[data-group],[data-view],[data-goto-day]');
    if (!t) return;
    if (t.hasAttribute('data-goto-day')) {
      state.day = t.getAttribute('data-goto-day');
      state.dayAuto = true;
    } else if (t.hasAttribute('data-day')) {
      state.day = t.getAttribute('data-day');
      state.dayAuto = false;
    } else if (t.hasAttribute('data-group')) {
      state.group = t.getAttribute('data-group');
    } else if (t.hasAttribute('data-view')) {
      state.view = t.getAttribute('data-view');
    }
    render();
  });
  $('printBtn').addEventListener('click', function () { printAll(); window.print(); });
  window.addEventListener('beforeprint', printAll);
  window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });
  setInterval(function () { if (!document.hidden) render(); }, 20000);

  renderHeader();
  render();
})();
