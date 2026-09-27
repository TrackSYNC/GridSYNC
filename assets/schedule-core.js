/* TSCC HPDE Scheduler: shared logic for the participant page and the organizer builder.
   Plain browser JavaScript with no dependencies. Also loads in Node for the tests
   (module.exports), so keep it free of DOM access outside the helpers marked "browser". */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var DRAFT_KEY = 'tscc-hpde-scheduler:draft:v1';
  var PREFS_KEY = 'tscc-hpde-scheduler:prefs:v1';
  var INK = '#15181D';
  var DASH = '–';
  var DOT = ' · ';

  var KINDS = {
    track: { label: 'Track', short: 'Track', solo: 'Track session', name: 'Track session' },
    classroom: { label: 'Classroom', short: 'Class', solo: 'Classroom', name: 'Classroom' },
    checkin: { label: 'Check-In', short: 'Check-In', solo: 'Check-In', name: 'Check-In' },
    meeting: { label: 'Meeting', short: 'Meeting', solo: 'Meeting', name: 'Meeting' },
    'break': { label: 'Break', short: 'Break', solo: 'Break', name: 'Break or lunch' },
    general: { label: 'General', short: 'Info', solo: 'General', name: 'General (gates, tech, other)' }
  };
  var KIND_ORDER = ['track', 'classroom', 'checkin', 'meeting', 'break', 'general'];

  // TSCC's standard run groups, used for a brand-new schedule.
  var DEFAULT_GROUPS = [
    { id: 'white', name: 'White', level: 'Instructor', color: '#7F7F7F', tint: '#D9D9D9' },
    { id: 'green', name: 'Green', level: 'Novice', color: '#538135', tint: '#C5E0B3' },
    { id: 'yellow', name: 'Yellow', level: 'Intermediate', color: '#FFC000', tint: '#FFE599' },
    { id: 'purple', name: 'Purple', level: 'Upper Intermediate', color: '#7030A0', tint: '#DC9DF5' },
    { id: 'blue', name: 'Blue', level: 'Advanced', color: '#2E74B5', tint: '#B4C6E7' }
  ];

  /* ------------------------------------------------------------------ text */

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function slug(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
  }
  var idCounter = 0;
  function uid(prefix) {
    idCounter += 1;
    return (prefix || 'i') + '-' + Date.now().toString(36).slice(-4) +
      Math.random().toString(36).slice(2, 6) + idCounter.toString(36);
  }
  function listNames(names) {
    if (names.length <= 1) return names.join('');
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  /* ------------------------------------------------------------------ time */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isNum(v) { return typeof v === 'number' && !isNaN(v); }

  // "HH:MM" -> minutes after midnight. Empty -> null. Anything else -> NaN.
  function parseTime(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim();
    if (s === '') return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return NaN;
    var h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return NaN;
    return h * 60 + mi;
  }
  function toHHMM(min) {
    min = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
  }
  function clock(min) {
    var h = Math.floor(min / 60) % 24;
    return ((h % 12) || 12) + ':' + pad(min % 60);
  }
  function meridiem(min) { return (Math.floor(min / 60) % 24) < 12 ? 'AM' : 'PM'; }
  function fmtTime(min) { return isNum(min) ? clock(min) + ' ' + meridiem(min) : ''; }
  // Range pieces: a = start (meridiem only if it differs), b = end with meridiem.
  function fmtRange(start, end) {
    if (!isNum(start)) return { a: '', b: '', text: '' };
    if (!isNum(end)) return { a: fmtTime(start), b: '', text: fmtTime(start) };
    var a = meridiem(start) === meridiem(end) ? clock(start) : fmtTime(start);
    var b = fmtTime(end);
    return { a: a, b: b, text: a + DASH + b };
  }
  function nb(text) { return esc(text).replace(/ /g, '&nbsp;'); }
  function fmtDuration(min) {
    min = Math.max(0, Math.round(min));
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }
  function fmtUntil(min) { return min <= 0 ? 'now' : 'in ' + fmtDuration(min); }

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s).trim());
    if (!m) return null;
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return null;
    return d;
  }
  function fmtDate(s, withYear) {
    var d = parseDate(s);
    if (!d) return '';
    return DOW[d.getUTCDay()] + ', ' + MON[d.getUTCMonth()] + ' ' + d.getUTCDate() +
      (withYear ? ', ' + d.getUTCFullYear() : '');
  }
  function fmtMonthDay(s, withYear) {
    var d = parseDate(s);
    return d ? MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + (withYear ? ', ' + d.getUTCFullYear() : '') : '';
  }
  function fmtDateShort(s) {
    var d = parseDate(s);
    return d ? DOW[d.getUTCDay()] + ' ' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() : '';
  }
  function fmtDateSpan(days) {
    var dates = days.map(function (d) { return d.date; }).filter(parseDate).sort();
    if (!dates.length) return '';
    if (dates.length === 1) return fmtDate(dates[0], true);
    return fmtDate(dates[0]) + ' ' + DASH + ' ' + fmtDate(dates[dates.length - 1], true);
  }
  function fmtStamp(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    var mins = d.getHours() * 60 + d.getMinutes();
    return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' at ' + fmtTime(mins);
  }

  // Current wall-clock date and minutes at the track, using the event time zone.
  function nowInZone(tz, date) {
    date = date || new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(date);
      var p = {};
      parts.forEach(function (x) { p[x.type] = x.value; });
      return { date: p.year + '-' + p.month + '-' + p.day, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
    } catch (e) {
      return {
        date: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()),
        minutes: date.getHours() * 60 + date.getMinutes()
      };
    }
  }

  /* ---------------------------------------------------------------- colors */

  function normHex(hex, fallback) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str(hex).trim());
    if (!m) return fallback;
    var h = m[1];
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return '#' + h.toUpperCase();
  }
  function rgbOf(hex) {
    hex = normHex(hex, '#999999');
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  function luminance(hex) {
    var c = rgbOf(hex).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function textOn(bg) { return contrast(bg, '#FFFFFF') >= contrast(bg, INK) ? '#FFFFFF' : INK; }
  function mix(a, b, t) {
    var x = rgbOf(a), y = rgbOf(b);
    return '#' + [0, 1, 2].map(function (i) {
      var v = Math.round(x[i] + (y[i] - x[i]) * t);
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('').toUpperCase();
  }
  function stripes(colors) {
    if (colors.length === 1) return colors[0];
    var n = colors.length;
    return 'linear-gradient(90deg,' + colors.map(function (c, i) {
      return c + ' ' + (i * 100 / n).toFixed(2) + '% ' + ((i + 1) * 100 / n).toFixed(2) + '%';
    }).join(',') + ')';
  }

  /* ------------------------------------------------------------ data model */

  function groupById(data, id) {
    for (var i = 0; i < data.groups.length; i++) if (data.groups[i].id === id) return data.groups[i];
    return null;
  }
  function dayById(data, id) {
    for (var i = 0; i < data.days.length; i++) if (data.days[i].id === id) return data.days[i];
    return null;
  }
  function itemGroupIds(item, data) {
    if (item.groups === 'all') return data.groups.map(function (g) { return g.id; });
    return (item.groups || []).filter(function (id) { return !!groupById(data, id); });
  }
  function itemLabel(item) { return item.title || KINDS[item.kind].label; }
  function groupNames(ids, data) {
    return listNames(ids.map(function (id) { var g = groupById(data, id); return g ? g.name : id; }));
  }
  function whoText(item, data) {
    if (item.groups === 'all') return 'Everyone';
    return groupNames(itemGroupIds(item, data), data);
  }

  function normTime(v) {
    var m = parseTime(v);
    return isNum(m) ? toHHMM(m) : str(v).trim();
  }

  function normalizeItem(it, groupIds, seenIds) {
    if (!it || typeof it !== 'object') return null;
    var groups;
    if (it.groups === 'all') groups = 'all';
    else if (Array.isArray(it.groups)) {
      groups = [];
      it.groups.forEach(function (g) {
        g = str(g);
        if (groupIds.indexOf(g) >= 0 && groups.indexOf(g) < 0) groups.push(g);
      });
    } else groups = [];
    var id = str(it.id).trim();
    if (!id || seenIds[id]) id = uid();
    seenIds[id] = true;
    return {
      id: id,
      start: normTime(it.start),
      end: normTime(it.end),
      kind: KINDS[it.kind] ? it.kind : 'general',
      title: str(it.title).trim(),
      groups: groups,
      location: str(it.location).trim(),
      note: str(it.note).trim()
    };
  }

  function normalize(raw) {
    var src = raw && typeof raw === 'object' ? clone(raw) : {};
    var ev = src.event && typeof src.event === 'object' ? src.event : {};
    var out = {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: str(src.updatedAt),
      event: {
        name: str(ev.name).trim() || 'TSCC HPDE',
        track: str(ev.track).trim(),
        timezone: str(ev.timezone).trim() || 'America/New_York',
        notice: str(ev.notice).trim()
      },
      groups: [],
      days: []
    };
    var seenGroups = {};
    (Array.isArray(src.groups) ? src.groups : []).forEach(function (g) {
      if (!g || typeof g !== 'object') return;
      var name = str(g.name).trim() || 'Group';
      var base = slug(g.id || name), id = base, n = 2;
      while (seenGroups[id]) id = base + '-' + (n++);
      seenGroups[id] = true;
      var color = normHex(g.color, '#6B7280');
      out.groups.push({ id: id, name: name, level: str(g.level).trim(), color: color, tint: normHex(g.tint, mix(color, '#FFFFFF', 0.7)) });
    });
    var groupIds = out.groups.map(function (g) { return g.id; });
    var seenDays = {}, seenItems = {};
    (Array.isArray(src.days) ? src.days : []).forEach(function (d, i) {
      if (!d || typeof d !== 'object') return;
      var base = slug(d.id || d.label || 'day-' + (i + 1)), id = base, n = 2;
      while (seenDays[id]) id = base + '-' + (n++);
      seenDays[id] = true;
      var items = (Array.isArray(d.items) ? d.items : [])
        .map(function (it) { return normalizeItem(it, groupIds, seenItems); })
        .filter(Boolean);
      out.days.push({
        id: id,
        label: str(d.label).trim() || 'Day ' + (i + 1),
        date: parseDate(d.date) ? str(d.date).trim() : '',
        items: items
      });
    });
    out.days.forEach(function (day) { sortItems(day, out); });
    return out;
  }

  function sortItems(day, data) {
    var idx = {};
    data.groups.forEach(function (g, i) { idx[g.id] = i; });
    function firstGroup(it) {
      if (it.groups === 'all') return -1;
      var best = 999;
      it.groups.forEach(function (g) { if (idx[g] !== undefined && idx[g] < best) best = idx[g]; });
      return best;
    }
    function key(v) { var m = parseTime(v); return isNum(m) ? m : 99999; }
    day.items.sort(function (a, b) {
      return (key(a.start) - key(b.start)) || (firstGroup(a) - firstGroup(b)) || (key(a.end) - key(b.end));
    });
  }

  function blankSchedule() {
    return normalize({
      event: { name: 'TSCC HPDE', track: '', timezone: 'America/New_York', notice: '' },
      groups: DEFAULT_GROUPS,
      days: [{ id: 'sat', label: 'Saturday', items: [] }, { id: 'sun', label: 'Sunday', items: [] }]
    });
  }

  /* ------------------------------------------------------------- analysis */

  function trackSummary(day, data) {
    var out = {};
    data.groups.forEach(function (g) { out[g.id] = { sessions: 0, minutes: 0 }; });
    day.items.forEach(function (it) {
      if (it.kind !== 'track') return;
      var s = parseTime(it.start), e = parseTime(it.end);
      var mins = isNum(s) && isNum(e) && e > s ? e - s : 0;
      itemGroupIds(it, data).forEach(function (g) {
        if (out[g]) { out[g].sessions += 1; out[g].minutes += mins; }
      });
    });
    return out;
  }
  function dayHasTrack(day) {
    return day.items.some(function (it) { return it.kind === 'track'; });
  }

  function spanText(it) {
    var r = fmtRange(parseTime(it.start), parseTime(it.end));
    return itemLabel(it) + ' (' + r.text + ')';
  }

  // Issues: { severity: 'error'|'warning', dayId, dayLabel, itemIds, message }
  function validate(data) {
    var issues = [];
    function add(sev, day, ids, msg) {
      issues.push({ severity: sev, dayId: day.id, dayLabel: day.label, itemIds: ids, message: msg });
    }
    if (!data.groups.length) {
      issues.push({ severity: 'error', dayId: '', dayLabel: '', itemIds: [], message: 'The schedule has no run groups.' });
    }
    data.days.forEach(function (day) {
      var spans = [];
      day.items.forEach(function (it) {
        var s = parseTime(it.start), e = parseTime(it.end), label = itemLabel(it);
        if (!isNum(s)) { add('error', day, [it.id], label + ' has no valid start time.'); return; }
        if (e !== null && !isNum(e)) { add('error', day, [it.id], label + ' at ' + fmtTime(s) + ' has an invalid end time.'); return; }
        if (isNum(e) && e <= s) {
          add('error', day, [it.id], label + ' ends at ' + fmtTime(e) + ', before it starts at ' + fmtTime(s) + '.');
          return;
        }
        var ids = itemGroupIds(it, data);
        if (!ids.length) add('error', day, [it.id], label + ' at ' + fmtTime(s) + ' is not assigned to a run group.');
        if (it.kind === 'track' && !isNum(e)) add('warning', day, [it.id], 'Track session at ' + fmtTime(s) + ' has no end time.');
        if (isNum(e) && ids.length) spans.push({ it: it, s: s, e: e, ids: ids });
      });
      for (var i = 0; i < spans.length; i++) {
        for (var j = i + 1; j < spans.length; j++) {
          var a = spans[i], b = spans[j];
          if (!(a.s < b.e && b.s < a.e)) continue;
          if (b.s > a.s) { var tmp = a; a = b; b = tmp; } // lead with the item that starts later
          var shared = a.ids.filter(function (x) { return b.ids.indexOf(x) >= 0; });
          if (shared.length) {
            var who = shared.length === data.groups.length ? 'Everyone' : groupNames(shared, data);
            add('error', day, [a.it.id, b.it.id],
              who + (shared.length === 1 || who === 'Everyone' ? ' is' : ' are') + ' double-booked. ' +
              spanText(a.it) + ' overlaps ' + spanText(b.it) + '.');
          } else if (a.it.kind === 'track' && b.it.kind === 'track') {
            add('error', day, [a.it.id, b.it.id],
              'Two sessions on track at once. ' + groupNames(a.ids, data) + ' ' + spanText(a.it) +
              ' overlaps ' + groupNames(b.ids, data) + ' ' + spanText(b.it) + '.');
          }
        }
      }
      if (dayHasTrack(day) && data.groups.length > 1) {
        var sum = trackSummary(day, data);
        var counts = data.groups.map(function (g) { return sum[g.id].sessions; });
        var min = Math.min.apply(null, counts), max = Math.max.apply(null, counts);
        if (min !== max) {
          var freq = {};
          counts.forEach(function (c) { freq[c] = (freq[c] || 0) + 1; });
          var mode = Number(Object.keys(freq).sort(function (x, y) { return (freq[y] - freq[x]) || (Number(y) - Number(x)); })[0]);
          var odd = data.groups.filter(function (g) { return sum[g.id].sessions !== mode; });
          add('warning', day, [],
            'Track sessions are uneven. ' + listNames(odd.map(function (g) { return g.name + ' has ' + sum[g.id].sessions; })) +
            '. The other groups have ' + mode + '.');
        }
      }
    });
    return issues;
  }

  /* ------------------------------------------------------------ rows/grid */

  // Rows share a start time. With lanes, items that would claim the same run group
  // in one row are pushed into an extra row so nothing is hidden.
  function buildRows(day, data, lanes) {
    var rows = [], unplaced = [];
    day.items.forEach(function (it) {
      var s = parseTime(it.start);
      if (!isNum(s)) { unplaced.push(it); return; }
      var ids = itemGroupIds(it, data);
      var row = null;
      if (lanes && !ids.length) {
        rows.push({ start: s, items: [it], taken: {}, unassigned: true });
        return;
      }
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.start !== s || r.unassigned) continue;
        if (!lanes || !ids.some(function (g) { return r.taken[g]; })) { row = r; break; }
      }
      if (!row) { row = { start: s, items: [], taken: {} }; rows.push(row); }
      row.items.push(it);
      ids.forEach(function (g) { row.taken[g] = true; });
    });
    rows.sort(function (a, b) { return a.start - b.start; });
    rows.forEach(finishRow);
    return { rows: rows, unplaced: unplaced };
  }
  function finishRow(row) {
    var ends = [], missing = 0;
    row.items.forEach(function (it) {
      var e = parseTime(it.end);
      if (isNum(e)) { if (ends.indexOf(e) < 0) ends.push(e); } else missing += 1;
    });
    row.end = ends.length === 1 && !missing ? ends[0] : null;
    row.mixed = ends.length > 1 || (ends.length > 0 && missing > 0);
    delete row.taken;
    return row;
  }

  function itemState(it, minutes) {
    var s = parseTime(it.start), e = parseTime(it.end);
    if (!isNum(s) || !isNum(minutes)) return '';
    if (isNum(e)) return minutes >= e ? 'past' : (minutes >= s ? 'now' : '');
    return minutes >= s ? 'past' : '';
  }
  function rowState(row, minutes) {
    if (!isNum(minutes)) return '';
    var states = row.items.map(function (it) { return itemState(it, minutes); });
    if (states.indexOf('now') >= 0) return 'now';
    return states.every(function (s) { return s === 'past'; }) ? 'past' : '';
  }

  function rowCells(row, data) {
    var cols = data.groups.map(function (g) { return g.id; });
    var owner = [];
    for (var k = 0; k < cols.length; k++) owner.push(null);
    row.items.forEach(function (it) {
      itemGroupIds(it, data).forEach(function (g) {
        var c = cols.indexOf(g);
        if (c >= 0 && !owner[c]) owner[c] = it;
      });
    });
    var cells = [], c = 0;
    while (c < cols.length) {
      var it = owner[c];
      if (!it) { cells.push({ col: c, span: 1, item: null, groups: [cols[c]] }); c += 1; continue; }
      var span = 1;
      while (c + span < cols.length && owner[c + span] === it) span += 1;
      cells.push({ col: c, span: span, item: it, groups: cols.slice(c, c + span) });
      c += span;
    }
    return cells;
  }

  // Background/foreground for an item drawn over the given run groups.
  function paint(item, groupIds, data) {
    var gs = groupIds.map(function (id) { return groupById(data, id); }).filter(Boolean);
    if (!gs.length) return '';
    if (item.kind === 'track') {
      return '--bg:' + stripes(gs.map(function (g) { return g.color; })) + ';--fg:' + textOn(gs[0].color) + ';';
    }
    if (item.kind === 'classroom' || item.kind === 'checkin') {
      return '--bg:' + stripes(gs.map(function (g) { return g.tint; })) + ';';
    }
    return '';
  }

  function tooltip(item, data) {
    var r = fmtRange(parseTime(item.start), parseTime(item.end));
    var parts = [whoText(item, data) + ': ' + itemLabel(item), r.text];
    if (item.location) parts.push(item.location);
    if (item.note) parts.push(item.note);
    return parts.join(DOT);
  }

  function labelHtml(item) { return esc(itemLabel(item)); }

  // opts: { highlightGroup, liveMinutes, clickable, issueIds (object id->true), selectedId }
  function renderGrid(data, day, opts) {
    opts = opts || {};
    if (!data.groups.length) return { html: '<div class="empty-state">Add a run group to see the grid.</div>', unplaced: day.items.slice() };
    var built = buildRows(day, data, true);
    if (!built.rows.length) {
      return { html: '<div class="empty-state">Nothing scheduled on ' + esc(day.label) + ' yet.</div>', unplaced: built.unplaced };
    }
    var n = data.groups.length;
    var hl = opts.highlightGroup && opts.highlightGroup !== 'all' && groupById(data, opts.highlightGroup) ? opts.highlightGroup : null;
    var issueIds = opts.issueIds || {};
    var live = isNum(opts.liveMinutes) ? opts.liveMinutes : null;
    var h = '<table class="sched' + (opts.clickable ? ' clickable' : '') + (hl ? ' has-hl' : '') + '">';
    h += '<caption class="visually-hidden">' + esc(day.label) + ' run schedule</caption>';
    h += '<colgroup><col class="c-time">';
    for (var k = 0; k < n; k++) h += '<col>';
    h += '</colgroup><thead><tr><th class="t-head" scope="col">Time</th>';
    data.groups.forEach(function (g) {
      h += '<th scope="col" style="--tint:' + g.tint + '" class="' + (hl ? (g.id === hl ? 'hl' : 'dim') : '') + '">' +
        esc(g.name) + (g.level ? '<span class="lvl">' + esc(g.level) + '</span>' : '') + '</th>';
    });
    h += '</tr></thead><tbody>';
    built.rows.forEach(function (row) {
      var st = live === null ? '' : rowState(row, live);
      var r = fmtRange(row.start, row.end);
      h += '<tr' + (st ? ' class="is-' + st + '"' : '') + '><th scope="row" class="t"><span class="t-a">' + nb(r.a) + '</span>' +
        (r.b ? '<span class="t-dash">' + DASH + '</span><wbr><span class="t-b">' + nb(r.b) + '</span>' : '') +
        (st === 'now' ? '<span class="now-tag">Now</span>' : '') + '</th>';
      if (row.unassigned) {
        var u = row.items[0];
        h += '<td colspan="' + n + '" class="cell k-unassigned' + (issueIds[u.id] ? ' has-issue' : '') + '" data-item="' + esc(u.id) + '"' +
          (opts.clickable ? ' tabindex="0" role="button"' : '') + ' title="' + esc(tooltip(u, data)) + '">' +
          '<span class="c-title">' + esc(itemLabel(u)) + '</span><span class="c-sub">No run group assigned</span></td>';
      } else {
        rowCells(row, data).forEach(function (cell) {
          var covers = hl ? cell.groups.indexOf(hl) >= 0 : false;
          var dim = hl && !covers ? ' dim' : '';
          if (!cell.item) {
            var g = groupById(data, cell.groups[0]);
            h += '<td class="empty' + dim + '" data-group="' + esc(cell.groups[0]) + '" data-start="' + toHHMM(row.start) + '"' +
              (isNum(row.end) ? ' data-end="' + toHHMM(row.end) + '"' : '') +
              (opts.clickable ? ' tabindex="0" role="button" aria-label="Add an item for ' + esc(g.name) + ' at ' + esc(fmtTime(row.start)) + '"' : '') +
              '></td>';
            return;
          }
          var it = cell.item;
          var classes = 'cell k-' + it.kind + dim + (issueIds[it.id] ? ' has-issue' : '') + (opts.selectedId === it.id ? ' is-selected' : '');
          var subs = '';
          var own = fmtRange(parseTime(it.start), parseTime(it.end));
          if (row.mixed || (isNum(parseTime(it.end)) && parseTime(it.end) !== row.end)) subs += '<span class="c-sub">' + esc(own.text) + '</span>';
          if (it.location) subs += '<span class="c-sub">' + esc(it.location) + '</span>';
          if (it.note && cell.span >= 2) subs += '<span class="c-sub note">' + esc(it.note) + '</span>';
          h += '<td class="' + classes + '"' + (cell.span > 1 ? ' colspan="' + cell.span + '"' : '') +
            ' style="' + paint(it, cell.groups, data) + '" data-item="' + esc(it.id) + '"' +
            (opts.clickable ? ' tabindex="0" role="button"' : '') +
            ' title="' + esc(tooltip(it, data)) + '" aria-label="' + esc(tooltip(it, data)) + '">' +
            '<span class="c-title">' + labelHtml(it) + '</span>' + subs + '</td>';
        });
      }
      h += '</tr>';
    });
    h += '</tbody></table>';
    return { html: h, unplaced: built.unplaced };
  }

  // Chronological list. opts: { group, liveMinutes }
  function renderTimeline(data, day, opts) {
    opts = opts || {};
    var group = opts.group && opts.group !== 'all' && groupById(data, opts.group) ? opts.group : null;
    var live = isNum(opts.liveMinutes) ? opts.liveMinutes : null;
    var rows = buildRows(day, data, false).rows.map(function (r) {
      var items = group ? r.items.filter(function (it) { return itemGroupIds(it, data).indexOf(group) >= 0; }) : r.items;
      return finishRow({ start: r.start, items: items });
    }).filter(function (r) { return r.items.length; });
    if (!rows.length) {
      var g = group ? groupById(data, group) : null;
      return '<div class="empty-state">Nothing scheduled' + (g ? ' for ' + esc(g.name) : '') + ' on ' + esc(day.label) + '.</div>';
    }
    var h = '<ol class="tl' + (group ? ' solo' : '') + '">';
    rows.forEach(function (row) {
      var st = live === null ? '' : rowState(row, live);
      h += '<li class="tl-row' + (st ? ' is-' + st : '') + '"><div class="tl-time">' + nb(fmtTime(row.start)) +
        (isNum(row.end) ? '<span class="t-b">to&nbsp;' + nb(fmtTime(row.end)) + '</span>' : '') +
        (st === 'now' ? '<span class="now-tag">Now</span>' : '') + '</div><div class="tl-entries">';
      row.items.forEach(function (it) { h += entryHtml(it, row, data, group); });
      h += '</div></li>';
    });
    return h + '</ol>';
  }

  function entryHtml(it, row, data, soloGroup) {
    var ids = itemGroupIds(it, data);
    var cls = 'entry k-' + it.kind + (!ids.length ? ' k-unassigned' : '');
    if (it.groups === 'all' || (!soloGroup && ids.length > 2)) cls += ' wide';
    var meta = [];
    var e = parseTime(it.end);
    if (row.mixed || (isNum(e) && e !== row.end)) meta.push(fmtRange(parseTime(it.start), e).text);
    if (it.location) meta.push(it.location);
    if (it.note) meta.push(it.note);
    var who = '';
    if (it.groups !== 'all') {
      if (soloGroup) {
        var others = ids.filter(function (id) { return id !== soloGroup; });
        if (others.length) meta.push('With ' + groupNames(others, data));
      } else {
        who = ids.length ? groupNames(ids, data) : 'No run group';
      }
    }
    var label = it.title || (soloGroup ? KINDS[it.kind].solo : KINDS[it.kind].label);
    return '<div class="' + cls + '" style="' + paint(it, ids, data) + '" data-item="' + esc(it.id) + '">' +
      (who ? '<span class="e-group">' + esc(who) + '</span>' + DOT : '') +
      '<span class="e-title">' + esc(label) + '</span>' +
      (meta.length ? '<span class="e-meta">' + esc(meta.join(DOT)) + '</span>' : '') + '</div>';
  }

  /* ----------------------------------------------------------- live state */

  // What is happening at `minutes` on `day`, optionally for one run group.
  function liveInfo(data, day, minutes, groupId) {
    var track = [], active = [], upcoming = [];
    day.items.forEach(function (it) {
      var s = parseTime(it.start), e = parseTime(it.end);
      if (!isNum(s)) return;
      var ids = itemGroupIds(it, data);
      if (groupId && ids.indexOf(groupId) < 0) return;
      if (isNum(e) && s <= minutes && minutes < e) active.push(it);
      if (s > minutes) upcoming.push(it);
    });
    day.items.forEach(function (it) {
      if (it.kind === 'track') track.push(it);
    });
    function startOf(it) { return parseTime(it.start); }
    upcoming.sort(function (a, b) { return startOf(a) - startOf(b); });
    var onTrack = track.filter(function (it) {
      var s = parseTime(it.start), e = parseTime(it.end);
      return isNum(s) && isNum(e) && s <= minutes && minutes < e;
    });
    var nextTrack = track.filter(function (it) { return parseTime(it.start) > minutes; })
      .sort(function (a, b) { return startOf(a) - startOf(b); });
    var nextGroupTrack = groupId ? upcoming.filter(function (it) { return it.kind === 'track'; }) : [];
    var last = 0;
    day.items.forEach(function (it) {
      var s = parseTime(it.start), e = parseTime(it.end);
      var t = isNum(e) ? e : s;
      if (isNum(t) && t > last) last = t;
    });
    return {
      onTrack: onTrack[0] || null,
      nextTrack: nextTrack[0] || null,
      active: active,
      next: upcoming[0] || null,
      nextGroupTrack: nextGroupTrack[0] || null,
      dayOver: minutes >= last
    };
  }

  /* ------------------------------------------------------- organizer tools */

  // Plan a rotation of track sessions. opts: { start, length, gap, count, order[], avoid }
  function planRotation(day, data, opts) {
    var blocks = [];
    if (opts.avoid) {
      day.items.forEach(function (it) {
        var s = parseTime(it.start), e = parseTime(it.end);
        if (!isNum(s) || !isNum(e) || e <= s) return;
        if (it.kind === 'track' || it.groups === 'all') blocks.push([s, e]);
      });
    }
    var out = [], t = opts.start;
    var order = opts.order.filter(function (id) { return !!groupById(data, id); });
    if (!order.length || !(opts.length > 0) || !(opts.count > 0)) return out;
    for (var i = 0; i < opts.count; i++) {
      var guard = 0, moved = true;
      while (moved && guard < 100) {
        moved = false;
        guard += 1;
        for (var b = 0; b < blocks.length; b++) {
          if (t < blocks[b][1] && blocks[b][0] < t + opts.length) { t = blocks[b][1]; moved = true; }
        }
      }
      if (t + opts.length > 1440) break;
      out.push({ start: t, end: t + opts.length, group: order[i % order.length] });
      t += opts.length + (opts.gap || 0);
    }
    return out;
  }

  // Items on `day` that start at or after `from` (minutes). Used by the shift tool.
  function itemsFrom(day, from) {
    return day.items.filter(function (it) {
      var s = parseTime(it.start);
      return isNum(s) && s >= from;
    });
  }

  /* ------------------------------------------------------------- files */

  function toScheduleJs(data) {
    var d = normalize(data);
    d.updatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return '/* TSCC HPDE schedule data. Exported from organizer.html on ' + d.updatedAt + '.\n' +
      '   To publish: replace data/schedule.js in the GitHub repository with this file. */\n' +
      'window.TSCC_SCHEDULE = ' + JSON.stringify(d, null, 2) + ';\n';
  }

  function parseScheduleText(text) {
    text = str(text);
    var anchor = text.indexOf('TSCC_SCHEDULE');
    var a = text.indexOf('{', anchor >= 0 ? anchor : 0);
    var b = text.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('No schedule data found in that file.');
    var obj;
    try { obj = JSON.parse(text.slice(a, b + 1)); } catch (e) { throw new Error('That file is not valid schedule data (' + e.message + ').'); }
    if (!obj || !Array.isArray(obj.days) || !Array.isArray(obj.groups)) {
      throw new Error('That file is not a TSCC schedule. It has no days or run groups.');
    }
    return normalize(obj);
  }

  /* ----------------------------------------------------- browser helpers */

  var store = {
    get: function (key) {
      try { var v = root.localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    set: function (key, value) {
      try { root.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove: function (key) {
      try { root.localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
    }
  };

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/javascript;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 3200);
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION, DRAFT_KEY: DRAFT_KEY, PREFS_KEY: PREFS_KEY,
    KINDS: KINDS, KIND_ORDER: KIND_ORDER, DEFAULT_GROUPS: DEFAULT_GROUPS, DASH: DASH, DOT: DOT,
    esc: esc, clone: clone, slug: slug, uid: uid, listNames: listNames,
    parseTime: parseTime, toHHMM: toHHMM, fmtTime: fmtTime, fmtRange: fmtRange, fmtDuration: fmtDuration,
    fmtUntil: fmtUntil, parseDate: parseDate, fmtDate: fmtDate, fmtMonthDay: fmtMonthDay, fmtDateShort: fmtDateShort,
    fmtDateSpan: fmtDateSpan, fmtStamp: fmtStamp, nowInZone: nowInZone, isNum: isNum,
    normHex: normHex, textOn: textOn, contrast: contrast, mix: mix, stripes: stripes,
    groupById: groupById, dayById: dayById, itemGroupIds: itemGroupIds, itemLabel: itemLabel,
    groupNames: groupNames, whoText: whoText, normalize: normalize, normalizeItem: normalizeItem,
    sortItems: sortItems, blankSchedule: blankSchedule, trackSummary: trackSummary, dayHasTrack: dayHasTrack,
    validate: validate, buildRows: buildRows, rowState: rowState, itemState: itemState, rowCells: rowCells,
    paint: paint, renderGrid: renderGrid, renderTimeline: renderTimeline, liveInfo: liveInfo,
    planRotation: planRotation, itemsFrom: itemsFrom, toScheduleJs: toScheduleJs,
    parseScheduleText: parseScheduleText, store: store, download: download, toast: toast
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TSCC = api;
})(typeof window !== 'undefined' ? window : this);
