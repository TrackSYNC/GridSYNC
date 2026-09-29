/* TSCC HPDE Scheduler: organizer builder (organizer.html).
   Starts from the published data/schedule.js, keeps a draft in this browser's
   localStorage, and exports a new schedule.js to commit to the repository.
   Nothing here can publish on its own. */
(function () {
  'use strict';

  var T = window.TSCC;
  var esc = T.esc;
  function $(id) { return document.getElementById(id); }
  function qsa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  var CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12l5 5L20 6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var UP_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var DOWN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var X_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  var TIMEZONES = [
    ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'],
    ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific']
  ];
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var TITLE_HINTS = {
    track: 'Track', classroom: 'Classroom', checkin: 'Check-In',
    meeting: 'e.g. Driver Meeting', 'break': 'e.g. Lunch', general: 'e.g. Gates Open'
  };

  /* ------------------------------------------------------------ load */

  var published = window.TSCC_SCHEDULE ? T.normalize(window.TSCC_SCHEDULE) : null;
  var state = {
    data: null, dayId: null, undo: [], redo: [], issues: [],
    savedAt: null, storageOk: true, editing: null, draftNote: '', draftWarn: false,
    basePublishedAt: published ? published.updatedAt : ''
  };

  function comparable(d) { var c = T.clone(d); c.updatedAt = ''; return JSON.stringify(c); }

  (function boot() {
    var saved = T.store.get(T.DRAFT_KEY);
    if (saved && saved.data) {
      var d = null;
      try { d = T.normalize(saved.data); } catch (e) { d = null; }
      if (d && (!published || comparable(d) !== comparable(published))) {
        state.data = d;
        state.savedAt = saved.savedAt || null;
        if (saved.basePublishedAt) state.basePublishedAt = saved.basePublishedAt;
        state.draftNote = 'Working from the draft saved in this browser' +
          (saved.savedAt ? ' on ' + T.fmtStamp(saved.savedAt) : '') + '. It differs from the published schedule.';
        if (published && saved.basePublishedAt && published.updatedAt && saved.basePublishedAt !== published.updatedAt) {
          state.draftNote += ' The published schedule changed after this draft was started. Check it before you export.';
          state.draftWarn = true;
        }
      }
    }
    if (!state.data) state.data = published ? T.clone(published) : T.blankSchedule();
    if (!published) {
      state.draftNote = (state.draftNote ? state.draftNote + ' ' : '') +
        'The published file data/schedule.js did not load, so the builder started from a blank template.';
      state.draftWarn = true;
    }
    var firstTrackDay = state.data.days.filter(T.dayHasTrack)[0] || state.data.days[0];
    state.dayId = firstTrackDay ? firstTrackDay.id : null;
  })();

  function day() { return state.dayId ? T.dayById(state.data, state.dayId) : null; }
  function ensureDay() {
    if (!day()) state.dayId = state.data.days.length ? state.data.days[0].id : null;
  }
  function findItem(id) {
    for (var i = 0; i < state.data.days.length; i++) {
      var d = state.data.days[i];
      for (var j = 0; j < d.items.length; j++) if (d.items[j].id === id) return { day: d, item: d.items[j] };
    }
    return null;
  }

  /* --------------------------------------------------------- history */

  function snapshot() { return JSON.stringify(state.data); }
  function pushUndo(before) {
    state.undo.push(before);
    if (state.undo.length > 150) state.undo.shift();
    state.redo = [];
  }
  // Apply a change, keep undo history, save the draft and redraw.
  // opts.keepGroups skips rebuilding the run group rows (the edit came from them).
  function commit(fn, message, opts) {
    var before = snapshot();
    fn(state.data);
    state.data = T.normalize(state.data);
    if (snapshot() === before) { render(opts); return false; }
    pushUndo(before);
    persist();
    render(opts);
    if (message) T.toast(message);
    return true;
  }
  function replaceData(next, message) {
    pushUndo(snapshot());
    state.data = T.normalize(next);
    ensureDay();
    persist();
    render();
    if (message) T.toast(message);
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    state.data = JSON.parse(state.undo.pop());
    ensureDay();
    persist();
    render();
    T.toast('Undone.');
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    state.data = JSON.parse(state.redo.pop());
    ensureDay();
    persist();
    render();
    T.toast('Redone.');
  }
  function persist() {
    var now = new Date().toISOString();
    state.storageOk = T.store.set(T.DRAFT_KEY, {
      savedAt: now,
      basePublishedAt: state.basePublishedAt,
      data: state.data
    });
    if (state.storageOk) state.savedAt = now;
  }

  /* ---------------------------------------------------------- render */

  function render(opts) {
    opts = opts || {};
    ensureDay();
    state.issues = T.validate(state.data);
    renderHeader();
    renderEvent();
    renderDays();
    renderGrid();
    renderChecks();
    renderSummary();
    if (!opts.keepGroups) renderGroups();
    renderStatus();
  }

  function setVal(el, v) {
    if (document.activeElement !== el && el.value !== v) el.value = v;
  }
  function timeOrStamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) return 'at ' + T.fmtTime(d.getHours() * 60 + d.getMinutes());
    return T.fmtStamp(iso);
  }

  function renderHeader() {
    var ev = state.data.event;
    $('eventName').textContent = ev.name;
    document.title = ev.name + ' · Schedule Builder';
    $('eventMeta').innerHTML = [ev.track, T.fmtDateSpan(state.data.days)].filter(Boolean)
      .map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('');
    var b = $('draftBanner');
    if (state.draftNote) {
      b.hidden = false;
      b.className = 'inline-banner ' + (state.draftWarn ? 'warn' : 'info');
      $('draftBannerText').textContent = state.draftNote;
    } else {
      b.hidden = true;
    }
    $('publishSub').textContent = published && published.updatedAt
      ? 'Published version: ' + T.fmtStamp(published.updatedAt) + '.'
      : 'No published version was found.';
  }

  function renderEvent() {
    var ev = state.data.event;
    setVal($('evName'), ev.name);
    setVal($('evTrack'), ev.track);
    setVal($('evNotice'), ev.notice);
    var st = ev.status || null;
    setVal($('evStatus'), st ? st.state : '');
    setVal($('evStatusMin'), st && st.minutes ? String(st.minutes) : '');
    setVal($('evStatusMsg'), st ? st.message : '');
    $('evStatusMin').disabled = !st || st.state !== 'delay';
    $('evStatusMsg').disabled = !st;
    var tz = $('evTz');
    if (document.activeElement !== tz) {
      var opts = TIMEZONES.slice();
      if (!opts.some(function (o) { return o[0] === ev.timezone; })) opts.push([ev.timezone, '']);
      tz.innerHTML = opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '">' + esc(o[1] ? o[1] + ' (' + o[0].replace(/_/g, ' ') + ')' : o[0]) + '</option>';
      }).join('');
      tz.value = ev.timezone;
    }
  }

  function renderDays() {
    var d = day();
    $('dayTabs').innerHTML = state.data.days.map(function (x) {
      return '<button type="button" data-day="' + esc(x.id) + '" aria-pressed="' + (x.id === state.dayId) + '">' + esc(x.label) +
        '<span class="seg-sub">' + (x.date ? esc(T.fmtDateShort(x.date)) : 'No date') + '</span></button>';
    }).join('') || '<span class="muted" style="padding:8px 12px;font-size:13px">No days yet</span>';
    $('daySettings').hidden = !d;
    if (d) {
      setVal($('dayLabelInput'), d.label);
      setVal($('dayDateInput'), d.date);
    }
  }

  function issueIndex() {
    var ids = {};
    state.issues.forEach(function (i) { i.itemIds.forEach(function (id) { ids[id] = true; }); });
    return ids;
  }

  function renderGrid() {
    var d = day(), wrap = $('gridWrap'), un = $('unplaced');
    if (!d) {
      wrap.innerHTML = '<div class="empty-state">Add a day to start building the schedule.</div>';
      un.hidden = true;
      return;
    }
    var out = T.renderGrid(state.data, d, {
      clickable: true, issueIds: issueIndex(), selectedId: state.editing ? state.editing.id : null
    });
    wrap.innerHTML = out.html;
    if (out.unplaced.length) {
      un.hidden = false;
      un.innerHTML = '<div class="inline-banner err"><span class="ib-text"><b>Not on the grid.</b> These items have no valid start time.</span>' +
        '<span class="toolbar">' + out.unplaced.map(function (it) {
          return '<button type="button" class="btn btn-secondary btn-sm" data-edit="' + esc(it.id) + '">' + esc(T.itemLabel(it)) + '</button>';
        }).join('') + '</span></div>';
    } else {
      un.hidden = true;
      un.innerHTML = '';
    }
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function renderChecks() {
    var errs = state.issues.filter(function (i) { return i.severity === 'error'; });
    var warns = state.issues.filter(function (i) { return i.severity === 'warning'; });
    $('checksChips').innerHTML =
      (errs.length ? '<span class="errchip">' + plural(errs.length, 'error') + '</span>' : '') +
      (warns.length ? '<span class="warnchip">' + plural(warns.length, 'warning') + '</span>' : '') +
      (!state.issues.length ? '<span class="editchip">All clear</span>' : '');
    if (!state.issues.length) {
      $('checksBody').innerHTML = '<div class="all-clear">No conflicts. Each run group has one thing at a time, one group is on track at a time, and every group gets the same number of track sessions each day.</div>';
      return;
    }
    $('checksBody').innerHTML = '<ul class="issues">' + errs.concat(warns).map(function (iss) {
      var idx = state.issues.indexOf(iss);
      return '<li class="issue ' + (iss.severity === 'error' ? 'err' : 'warn') + '"><button type="button" data-issue="' + idx + '">' +
        '<span class="sev">' + (iss.severity === 'error' ? 'Error' : 'Warning') + '</span><span>' +
        (iss.dayLabel ? '<span class="where">' + esc(iss.dayLabel) + '.</span> ' : '') + esc(iss.message) + '</span></button></li>';
    }).join('') + '</ul>';
  }

  function renderSummary() {
    var data = state.data;
    var days = data.days.filter(T.dayHasTrack);
    if (!days.length || !data.groups.length) {
      $('summaryBody').innerHTML = '<div class="empty-state">No track sessions yet.</div>';
      return;
    }
    var sums = days.map(function (d) { return T.trackSummary(d, data); });
    var modes = sums.map(function (sum) {
      var freq = {};
      data.groups.forEach(function (g) { var c = sum[g.id].sessions; freq[c] = (freq[c] || 0) + 1; });
      return Number(Object.keys(freq).sort(function (a, b) { return (freq[b] - freq[a]) || (Number(b) - Number(a)); })[0]);
    });
    var h = '<table class="sum"><thead><tr><th scope="col">Run group</th>' +
      days.map(function (d) { return '<th scope="col">' + esc(d.label) + '</th>'; }).join('') +
      '<th scope="col">Total</th></tr></thead><tbody>';
    data.groups.forEach(function (g) {
      var ts = 0, tm = 0;
      h += '<tr><th scope="row"><span class="gname"><span class="sw sq" style="--c:' + g.color + '"></span>' + esc(g.name) + '</span></th>';
      sums.forEach(function (sum, i) {
        var s = sum[g.id];
        ts += s.sessions;
        tm += s.minutes;
        h += '<td' + (s.sessions !== modes[i] ? ' class="off"' : '') + '>' + s.sessions +
          ' <span class="mins">&middot; ' + esc(T.fmtDuration(s.minutes)) + '</span></td>';
      });
      h += '<td><b>' + ts + '</b> <span class="mins">&middot; ' + esc(T.fmtDuration(tm)) + '</span></td></tr>';
    });
    $('summaryBody').innerHTML = h + '</tbody></table>';
  }

  function renderGroups() {
    var gs = state.data.groups;
    $('groupRows').innerHTML = gs.map(function (g, i) {
      var id = esc(g.id), name = esc(g.name);
      return '<div class="group-row" data-gid="' + id + '">' +
        '<div class="color-field"><label for="gc-' + id + '">Track</label><input type="color" id="gc-' + id + '" data-gfield="color" value="' + g.color.toLowerCase() + '"></div>' +
        '<div class="color-field"><label for="gt-' + id + '">Light</label><input type="color" id="gt-' + id + '" data-gfield="tint" value="' + g.tint.toLowerCase() + '"></div>' +
        '<div class="field"><label for="gn-' + id + '">Name</label><input type="text" id="gn-' + id + '" data-gfield="name" value="' + name + '"></div>' +
        '<div class="field f-level"><label for="gl-' + id + '">Level</label><input type="text" id="gl-' + id + '" data-gfield="level" value="' + esc(g.level) + '" placeholder="e.g. Novice"></div>' +
        '<div class="row-actions">' +
        '<button type="button" class="icon-btn" data-gmove="-1" aria-label="Move ' + name + ' up"' + (i === 0 ? ' disabled' : '') + '>' + UP_SVG + '</button>' +
        '<button type="button" class="icon-btn" data-gmove="1" aria-label="Move ' + name + ' down"' + (i === gs.length - 1 ? ' disabled' : '') + '>' + DOWN_SVG + '</button>' +
        '<button type="button" class="icon-btn danger" data-gremove aria-label="Remove ' + name + '">' + X_SVG + '</button>' +
        '</div></div>';
    }).join('') || '<div class="empty-state">No run groups. Add one to build the grid.</div>';
  }

  function renderStatus() {
    var e = state.issues.filter(function (i) { return i.severity === 'error'; }).length;
    var w = state.issues.length - e;
    $('statusBtn').className = 'status' + (e ? ' err' : (w ? ' warn' : ''));
    $('statusText').textContent = e ? plural(e, 'error') + (w ? ', ' + plural(w, 'warning') : '')
      : (w ? plural(w, 'warning') : 'No conflicts');
    $('statusSub').textContent = !state.storageOk
      ? 'Browser storage is blocked. Export before you leave this page.'
      : (state.savedAt ? 'Draft saved ' + timeOrStamp(state.savedAt) : 'Matches the published schedule');
    $('undoBtn').disabled = !state.undo.length;
    $('redoBtn').disabled = !state.redo.length;
  }

  /* ---------------------------------------------------------- modals */

  var lastFocus = null;
  function openModal(id, focusId) {
    lastFocus = document.activeElement;
    $(id).classList.add('show');
    var f = focusId ? $(focusId) : $(id).querySelector('select, input, button');
    if (f) f.focus();
  }
  function closeModal(id) {
    $(id).classList.remove('show');
    if (id === 'itemModal' && state.editing) {
      var editedId = state.editing.id;
      state.editing = null;
      renderGrid();
      var cell = editedId && $('gridWrap').querySelector('[data-item="' + editedId + '"]');
      if (cell) { cell.focus(); return; }
    }
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  function openModalId() {
    var m = document.querySelector('.modal-overlay.show');
    return m ? m.id : null;
  }

  var confirmCb = null;
  function confirmBox(title, text, okLabel, onOk, variant) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    var ok = $('confirmOk');
    ok.textContent = okLabel;
    ok.className = 'btn ' + (variant === 'primary' ? 'btn-primary' : 'btn-red');
    confirmCb = onOk;
    openModal('confirmModal', 'confirmOk');
  }

  /* ----------------------------------------------------- item editor */

  $('imKind').innerHTML = T.KIND_ORDER.map(function (k) {
    return '<option value="' + k + '">' + esc(T.KINDS[k].name) + '</option>';
  }).join('');

  function updateTitleHint() { $('imTitle').placeholder = TITLE_HINTS[$('imKind').value] || ''; }
  function syncAllToggle() {
    var all = $('imAll').checked;
    qsa($('imGroups'), 'input').forEach(function (i) { i.disabled = all; });
  }

  function fillItemForm(it, dayObj) {
    $('imKind').value = it.kind;
    $('imTitle').value = it.title;
    updateTitleHint();
    $('imStart').value = T.isNum(T.parseTime(it.start)) ? it.start : '';
    $('imEnd').value = T.isNum(T.parseTime(it.end)) ? it.end : '';
    $('imLocation').value = it.location;
    $('imNote').value = it.note;
    $('imAll').checked = it.groups === 'all';
    $('imGroups').innerHTML = state.data.groups.map(function (g) {
      var on = it.groups !== 'all' && it.groups.indexOf(g.id) >= 0;
      return '<label class="check" style="--c:' + g.color + ';--fg:' + T.textOn(g.color) + '"><input type="checkbox" value="' + esc(g.id) + '"' +
        (on ? ' checked' : '') + '><span class="box">' + CHECK_SVG + '</span><span class="check-text">' + esc(g.name) +
        (g.level ? '<span class="check-sub">' + esc(g.level) + '</span>' : '') + '</span></label>';
    }).join('');
    syncAllToggle();
    $('imError').textContent = '';
    $('itemModalSub').textContent = dayObj.label + (dayObj.date ? ', ' + T.fmtMonthDay(dayObj.date, true) : '');
  }

  function openItem(itemId) {
    var found = findItem(itemId);
    if (!found) return;
    state.dayId = found.day.id;
    state.editing = { id: itemId, isNew: false, dayId: found.day.id };
    render();
    fillItemForm(found.item, found.day);
    $('itemModalTitle').textContent = found.item.title ? 'Edit "' + found.item.title + '"'
      : 'Edit ' + (found.item.kind === 'track' ? 'track session' : T.KINDS[found.item.kind].label.toLowerCase());
    $('imDelete').hidden = false;
    $('imDuplicate').hidden = false;
    openModal('itemModal', 'imStart');
  }

  function lastEnd(d) {
    var best = null;
    d.items.forEach(function (it) {
      var e = T.parseTime(it.end), s = T.parseTime(it.start);
      var t = T.isNum(e) ? e : s;
      if (T.isNum(t) && (best === null || t > best)) best = t;
    });
    return best;
  }

  function openNew(preset) {
    var d = day();
    if (!d) { T.toast('Add a day first.'); return; }
    var it = {
      id: '', start: '', end: '', kind: 'track', title: '', groups: [], location: '', note: ''
    };
    Object.keys(preset || {}).forEach(function (k) { if (preset[k] !== undefined) it[k] = preset[k]; });
    var s = T.parseTime(it.start);
    if (!T.isNum(s)) {
      var le = lastEnd(d);
      s = le === null ? 8 * 60 : le;
      it.start = T.toHHMM(s);
    }
    if (!T.isNum(T.parseTime(it.end))) it.end = T.toHHMM(Math.min(s + 25, 1439));
    state.editing = { id: null, isNew: true, dayId: d.id };
    fillItemForm(it, d);
    $('itemModalTitle').textContent = 'Add item';
    $('imDelete').hidden = true;
    $('imDuplicate').hidden = true;
    openModal('itemModal', it.groups.length ? 'imStart' : 'imKind');
  }

  function readItemForm() {
    var start = $('imStart').value, end = $('imEnd').value;
    var s = T.parseTime(start), e = T.parseTime(end);
    var kind = $('imKind').value;
    if (!T.isNum(s)) return { error: 'Enter a start time.' };
    if (end && !T.isNum(e)) return { error: 'Enter a valid end time, or leave it blank.' };
    if (T.isNum(e) && e <= s) return { error: 'The end time has to be after the start time.' };
    if (kind === 'track' && !T.isNum(e)) return { error: 'Track sessions need an end time.' };
    var groups = $('imAll').checked ? 'all'
      : qsa($('imGroups'), 'input:checked').map(function (i) { return i.value; });
    if (groups !== 'all' && !groups.length) return { error: 'Pick at least one run group, or Everyone.' };
    return {
      item: {
        start: T.toHHMM(s), end: T.isNum(e) ? T.toHHMM(e) : '', kind: kind,
        title: $('imTitle').value.trim(), groups: groups,
        location: $('imLocation').value.trim(), note: $('imNote').value.trim()
      }
    };
  }

  function saveItem() {
    var r = readItemForm();
    if (r.error) { $('imError').textContent = r.error; return null; }
    var ed = state.editing;
    var newId = ed.isNew ? T.uid() : ed.id;
    state.editing = null;
    $('itemModal').classList.remove('show');
    commit(function (data) {
      var d = T.dayById(data, ed.dayId);
      if (!d) return;
      if (ed.isNew) {
        var copy = T.clone(r.item);
        copy.id = newId;
        d.items.push(copy);
      } else {
        d.items.forEach(function (it) { if (it.id === ed.id) { Object.keys(r.item).forEach(function (k) { it[k] = r.item[k]; }); } });
      }
    });
    var cell = $('gridWrap').querySelector('[data-item="' + newId + '"]');
    if (cell) cell.focus();
    return r.item;
  }

  function deleteItem() {
    var ed = state.editing;
    if (!ed || ed.isNew) return;
    state.editing = null;
    $('itemModal').classList.remove('show');
    commit(function (data) {
      var d = T.dayById(data, ed.dayId);
      if (d) d.items = d.items.filter(function (it) { return it.id !== ed.id; });
    }, 'Deleted. Press Ctrl+Z to undo.');
  }

  function duplicateItem() {
    var saved = saveItem();
    if (!saved) return;
    var s = T.parseTime(saved.start), e = T.parseTime(saved.end);
    var len = T.isNum(e) ? e - s : 25;
    var ns = T.isNum(e) ? e : s + len;
    openNew({
      kind: saved.kind, title: saved.title, location: saved.location, note: saved.note,
      groups: saved.groups === 'all' ? 'all' : saved.groups.slice(),
      start: T.toHHMM(Math.min(ns, 1438)), end: T.toHHMM(Math.min(ns + len, 1439))
    });
  }

  /* -------------------------------------------------------- rotation */

  var rot = { order: [], enabled: {} };

  function openRotation() {
    var d = day();
    if (!d) { T.toast('Add a day first.'); return; }
    if (!state.data.groups.length) { T.toast('Add a run group first.'); return; }
    $('rotSub').textContent = 'Adds track sessions to ' + d.label + ' in a repeating group order.';
    var le = lastEnd(d);
    $('rotStart').value = T.toHHMM(le === null ? 8 * 60 + 30 : le);
    $('rotLen').value = 25;
    $('rotGap').value = 0;
    $('rotCount').value = state.data.groups.length;
    $('rotAvoid').checked = true;
    rot.order = state.data.groups.map(function (g) { return g.id; });
    rot.enabled = {};
    rot.order.forEach(function (id) { rot.enabled[id] = true; });
    renderRotOrder();
    updateRotPreview();
    openModal('rotModal', 'rotStart');
  }

  function renderRotOrder() {
    $('rotOrder').innerHTML = rot.order.map(function (id, i) {
      var g = T.groupById(state.data, id);
      return '<li data-rid="' + esc(id) + '"><span class="num">' + (i + 1) + '</span>' +
        '<label class="check" style="--c:' + g.color + ';--fg:' + T.textOn(g.color) + '"><input type="checkbox" data-rcheck' +
        (rot.enabled[id] ? ' checked' : '') + '><span class="box">' + CHECK_SVG + '</span>' + esc(g.name) + '</label>' +
        '<button type="button" class="icon-btn" data-rmove="-1" aria-label="Move ' + esc(g.name) + ' earlier"' + (i === 0 ? ' disabled' : '') + '>' + UP_SVG + '</button>' +
        '<button type="button" class="icon-btn" data-rmove="1" aria-label="Move ' + esc(g.name) + ' later"' + (i === rot.order.length - 1 ? ' disabled' : '') + '>' + DOWN_SVG + '</button></li>';
    }).join('');
  }

  function rotOptions() {
    return {
      start: T.parseTime($('rotStart').value),
      length: parseInt($('rotLen').value, 10),
      gap: Math.max(0, parseInt($('rotGap').value, 10) || 0),
      count: Math.min(60, parseInt($('rotCount').value, 10) || 0),
      order: rot.order.filter(function (id) { return rot.enabled[id]; }),
      avoid: $('rotAvoid').checked
    };
  }

  function rotPlan() {
    var o = rotOptions();
    if (!T.isNum(o.start)) return { error: 'Enter a start time.' };
    if (!(o.length > 0)) return { error: 'Enter a session length.' };
    if (!(o.count > 0)) return { error: 'Enter how many sessions to add.' };
    if (!o.order.length) return { error: 'Pick at least one run group.' };
    var plan = T.planRotation(day(), state.data, o);
    if (!plan.length) return { error: 'Nothing fits before midnight. Try an earlier start.' };
    return { plan: plan, options: o };
  }

  function updateRotPreview() {
    var r = rotPlan();
    $('rotApply').disabled = !!r.error;
    if (r.error) { $('rotPreview').textContent = r.error; return; }
    var first = r.plan[0], last = r.plan[r.plan.length - 1];
    var names = r.options.order.map(function (id) { return T.groupById(state.data, id).name; });
    $('rotPreview').textContent = 'Adds ' + plural(r.plan.length, 'track session') + ' from ' + T.fmtTime(first.start) +
      ' to ' + T.fmtTime(last.end) + '. Order: ' + names.join(', ') + '.' +
      (r.plan.length < r.options.count ? ' Only ' + r.plan.length + ' fit before midnight.' : '');
  }

  function applyRotation() {
    var r = rotPlan();
    if (r.error) return;
    var dayId = state.dayId;
    $('rotModal').classList.remove('show');
    commit(function (data) {
      var d = T.dayById(data, dayId);
      r.plan.forEach(function (p) {
        d.items.push({
          id: T.uid(), start: T.toHHMM(p.start), end: T.toHHMM(p.end), kind: 'track',
          title: '', groups: [p.group], location: '', note: ''
        });
      });
    }, 'Added ' + plural(r.plan.length, 'track session') + '.');
  }

  /* ----------------------------------------------------------- shift */

  function openShift() {
    var d = day();
    if (!d) { T.toast('Add a day first.'); return; }
    if (!d.items.length) { T.toast('Nothing on ' + d.label + ' to move.'); return; }
    $('shiftSub').textContent = 'Moves items on ' + d.label + '. Use a negative number to move them earlier.';
    var first = null;
    d.items.forEach(function (it) {
      var s = T.parseTime(it.start);
      if (T.isNum(s) && (first === null || s < first)) first = s;
    });
    $('shiftFrom').value = T.toHHMM(first === null ? 480 : first);
    $('shiftBy').value = 10;
    updateShiftPreview();
    openModal('shiftModal', 'shiftFrom');
  }

  function shiftPlan() {
    var from = T.parseTime($('shiftFrom').value);
    var by = parseInt($('shiftBy').value, 10);
    if (!T.isNum(from)) return { error: 'Enter a time.' };
    if (!by) return { error: 'Enter how many minutes to move them.' };
    var items = T.itemsFrom(day(), from);
    if (!items.length) return { error: 'Nothing starts at or after ' + T.fmtTime(from) + '.' };
    for (var i = 0; i < items.length; i++) {
      var s = T.parseTime(items[i].start) + by, e = T.parseTime(items[i].end);
      if (s < 0 || s >= 1440 || (T.isNum(e) && (e + by > 1439 || e + by < 0))) {
        return { error: 'That would move ' + T.itemLabel(items[i]) + ' past midnight.' };
      }
    }
    return { items: items, by: by, from: from };
  }

  function updateShiftPreview() {
    var p = shiftPlan();
    $('shiftApply').disabled = !!p.error;
    $('shiftError').textContent = p.error || '';
    if (p.error) { $('shiftPreview').textContent = 'No changes yet.'; return; }
    var first = p.items[0], s = T.parseTime(first.start);
    $('shiftPreview').textContent = 'Moves ' + plural(p.items.length, 'item') + ' ' + (p.by > 0 ? 'later' : 'earlier') + ' by ' +
      T.fmtDuration(Math.abs(p.by)) + '. First: ' + T.whoText(first, state.data) + ' ' + T.itemLabel(first) + ' moves from ' +
      T.fmtTime(s) + ' to ' + T.fmtTime(s + p.by) + '.';
  }

  function applyShift() {
    var p = shiftPlan();
    if (p.error) return;
    var ids = {};
    p.items.forEach(function (it) { ids[it.id] = true; });
    var dayId = state.dayId;
    $('shiftModal').classList.remove('show');
    commit(function (data) {
      T.dayById(data, dayId).items.forEach(function (it) {
        if (!ids[it.id]) return;
        it.start = T.toHHMM(T.parseTime(it.start) + p.by);
        var e = T.parseTime(it.end);
        if (T.isNum(e)) it.end = T.toHHMM(e + p.by);
      });
    }, 'Moved ' + plural(p.items.length, 'item') + '.');
  }

  /* ------------------------------------------------------------ days */

  function addDays(dateStr, n) {
    var d = T.parseDate(dateStr);
    if (!d) return '';
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekdayOf(dateStr) {
    var d = T.parseDate(dateStr);
    return d ? WEEKDAYS[d.getUTCDay()] : '';
  }
  function uniqueId(taken, base) {
    var id = base || 'x', n = 2;
    while (taken.indexOf(id) >= 0) id = base + '-' + (n++);
    return id;
  }

  function addDay() {
    commit(function (data) {
      var last = data.days[data.days.length - 1];
      var date = last && T.parseDate(last.date) ? addDays(last.date, 1) : '';
      var label = date ? weekdayOf(date) : 'Day ' + (data.days.length + 1);
      var id = uniqueId(data.days.map(function (d) { return d.id; }), T.slug(T.slug(label).slice(0, 12)));
      data.days.push({ id: id, label: label, date: date, items: [] });
      state.dayId = id;
    }, 'Day added.');
    $('dayLabelInput').focus();
  }

  function duplicateDay() {
    var src = day();
    if (!src) return;
    commit(function (data) {
      var s = T.dayById(data, src.id);
      var date = '';
      if (T.parseDate(s.date)) {
        var cand = addDays(s.date, 1);
        if (!data.days.some(function (d) { return d.date === cand; })) date = cand;
      }
      var label = date ? weekdayOf(date) : 'Copy of ' + s.label;
      var id = uniqueId(data.days.map(function (d) { return d.id; }), T.slug(T.slug(label).slice(0, 12)));
      var copy = {
        id: id, label: label, date: date,
        items: s.items.map(function (it) {
          var c = T.clone(it);
          c.id = T.uid();
          return c;
        })
      };
      data.days.splice(data.days.indexOf(s) + 1, 0, copy);
      state.dayId = id;
    }, 'Day duplicated.');
  }

  function deleteDay() {
    var d = day();
    if (!d) return;
    confirmBox('Delete ' + d.label + '?', 'This removes ' + d.label + ' and its ' + plural(d.items.length, 'item') + '. You can undo this.', 'Delete day', function () {
      var idx = state.data.days.indexOf(d);
      commit(function (data) {
        data.days = data.days.filter(function (x) { return x.id !== d.id; });
        var next = data.days[Math.min(idx, data.days.length - 1)];
        state.dayId = next ? next.id : null;
      }, d.label + ' deleted.');
    });
  }

  /* ---------------------------------------------------------- groups */

  function addGroup() {
    var newId = null;
    commit(function (data) {
      newId = uniqueId(data.groups.map(function (g) { return g.id; }), 'group');
      data.groups.push({ id: newId, name: 'New group', level: '', color: '#6B7280', tint: '#E5E7EB' });
    });
    var input = newId && $('gn-' + newId);
    if (input) { input.focus(); input.select(); }
  }

  function moveGroup(gid, dir) {
    commit(function (data) {
      var i = data.groups.findIndex(function (g) { return g.id === gid; });
      var j = i + dir;
      if (i < 0 || j < 0 || j >= data.groups.length) return;
      var tmp = data.groups[i];
      data.groups[i] = data.groups[j];
      data.groups[j] = tmp;
    });
    var btn = document.querySelector('.group-row[data-gid="' + gid + '"] [data-gmove="' + dir + '"]');
    if (btn && !btn.disabled) btn.focus();
  }

  function removeGroup(gid) {
    var g = T.groupById(state.data, gid);
    if (!g) return;
    var only = 0, shared = 0;
    state.data.days.forEach(function (d) {
      d.items.forEach(function (it) {
        if (it.groups === 'all' || it.groups.indexOf(gid) < 0) return;
        if (it.groups.length === 1) only += 1; else shared += 1;
      });
    });
    var text = 'Removes the ' + g.name + ' column.' +
      (only ? ' ' + plural(only, 'item') + ' that only ' + g.name + ' has will be deleted.' : '') +
      (shared ? ' ' + plural(shared, 'shared item') + ' will drop ' + g.name + '.' : '') + ' You can undo this.';
    confirmBox('Remove ' + g.name + '?', text, 'Remove group', function () {
      commit(function (data) {
        data.groups = data.groups.filter(function (x) { return x.id !== gid; });
        data.days.forEach(function (d) {
          d.items = d.items.filter(function (it) {
            return !(it.groups !== 'all' && it.groups.length === 1 && it.groups[0] === gid);
          });
          d.items.forEach(function (it) {
            if (it.groups !== 'all') it.groups = it.groups.filter(function (x) { return x !== gid; });
          });
        });
      }, g.name + ' removed.');
    });
  }

  function editGroupField(gid, field, value) {
    commit(function (data) {
      var g = T.groupById(data, gid);
      if (!g) return;
      if (field === 'name') { if (value.trim()) g.name = value.trim(); }
      else if (field === 'level') g.level = value.trim();
      else if (field === 'color' || field === 'tint') g[field] = T.normHex(value, g[field]);
    }, null, { keepGroups: true });
  }

  /* ------------------------------------------------------ file flows */

  function exportFile(force) {
    var errs = state.issues.filter(function (i) { return i.severity === 'error'; }).length;
    if (errs && !force) {
      confirmBox('Export with ' + plural(errs, 'error') + '?',
        'The Checks panel lists problems such as double-booked groups. Participants will see the schedule exactly as exported.',
        'Export anyway', function () { exportFile(true); }, 'primary');
      return;
    }
    T.download('schedule.js', T.toScheduleJs(state.data));
    T.toast('schedule.js downloaded. Upload it to the data folder in the repository to publish.', 6000);
  }

  function previewParticipant() {
    persist();
    if (!state.storageOk) {
      T.toast('Browser storage is blocked here, so the preview cannot read the draft.', 5000);
      return;
    }
    window.open('index.html?draft=1' + (state.dayId ? '&day=' + encodeURIComponent(state.dayId) : ''), '_blank');
  }

  function discardDraft() {
    confirmBox('Discard the draft?',
      'This throws away the unpublished changes saved in this browser and reloads the published schedule. You can undo this until you leave the page.',
      'Discard draft', function () {
        state.basePublishedAt = published ? published.updatedAt : '';
        replaceData(published ? T.clone(published) : T.blankSchedule(), 'Draft discarded.');
        T.store.remove(T.DRAFT_KEY);
        state.savedAt = null;
        state.draftNote = published ? '' : 'The published file data/schedule.js did not load, so the builder started from a blank template.';
        state.draftWarn = !published;
        renderHeader();
        renderStatus();
      });
  }

  $('fileInput').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    if (/\.(xlsx|xls|csv)$/i.test(f.name)) {
      T.toast('Spreadsheets need converting first. Use tools/xlsx_to_schedule.py from the repository.', 6500);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var next;
      try { next = T.parseScheduleText(reader.result); } catch (e) { T.toast(e.message, 6500); return; }
      var items = next.days.reduce(function (n, d) { return n + d.items.length; }, 0);
      confirmBox('Load ' + f.name + '?',
        'This replaces the schedule you are editing with "' + next.event.name + '" (' + plural(next.days.length, 'day') + ', ' +
        plural(items, 'item') + '). You can undo this.', 'Load file', function () {
          state.basePublishedAt = published ? published.updatedAt : '';
          state.draftWarn = !published;
          state.draftNote = published ? '' : state.draftNote;
          replaceData(next, 'Loaded ' + f.name + '.');
          state.dayId = next.days.length ? next.days[0].id : null;
          render();
        }, 'primary');
    };
    reader.onerror = function () { T.toast('That file could not be read.'); };
    reader.readAsText(f);
  });

  /* ---------------------------------------------------------- events */

  var ACTIONS = {
    'add-day': addDay,
    'dup-day': duplicateDay,
    'del-day': deleteDay,
    'add-item': function () { openNew({}); },
    'rotation': openRotation,
    'shift': openShift,
    'undo': undo,
    'redo': redo,
    'add-group': addGroup,
    'export': function () { exportFile(false); },
    'preview': previewParticipant,
    'load': function () { $('fileInput').click(); },
    'discard': discardDraft
  };

  function activateCell(td) {
    if (td.hasAttribute('data-item')) { openItem(td.getAttribute('data-item')); return; }
    if (td.classList.contains('empty')) {
      openNew({
        start: td.getAttribute('data-start'),
        end: td.getAttribute('data-end') || undefined,
        groups: [td.getAttribute('data-group')],
        kind: 'track'
      });
    }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var el;
    if ((el = t.closest('[data-action]'))) { var fn = ACTIONS[el.getAttribute('data-action')]; if (fn) fn(); return; }
    if ((el = t.closest('[data-close]'))) { closeModal(el.closest('.modal-overlay').id); return; }
    if (t.classList && t.classList.contains('modal-overlay')) { closeModal(t.id); return; }
    if ((el = t.closest('#dayTabs [data-day]'))) { state.dayId = el.getAttribute('data-day'); render(); return; }
    if ((el = t.closest('#gridWrap td'))) { activateCell(el); return; }
    if ((el = t.closest('[data-edit]'))) { openItem(el.getAttribute('data-edit')); return; }
    if ((el = t.closest('[data-issue]'))) {
      var iss = state.issues[Number(el.getAttribute('data-issue'))];
      if (!iss) return;
      if (iss.dayId) state.dayId = iss.dayId;
      if (iss.itemIds.length) openItem(iss.itemIds[0]);
      else { render(); $('scheduleCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return;
    }
    if ((el = t.closest('[data-gmove]'))) { moveGroup(el.closest('.group-row').getAttribute('data-gid'), Number(el.getAttribute('data-gmove'))); return; }
    if ((el = t.closest('[data-gremove]'))) { removeGroup(el.closest('.group-row').getAttribute('data-gid')); return; }
    if ((el = t.closest('[data-rmove]'))) {
      var li = el.closest('li'), id = li.getAttribute('data-rid');
      var i = rot.order.indexOf(id), j = i + Number(el.getAttribute('data-rmove'));
      if (j >= 0 && j < rot.order.length) {
        rot.order[i] = rot.order[j];
        rot.order[j] = id;
        renderRotOrder();
        updateRotPreview();
      }
      return;
    }
    if ((el = t.closest('#imQuick [data-len]'))) {
      var s = T.parseTime($('imStart').value);
      if (T.isNum(s)) $('imEnd').value = T.toHHMM(Math.min(s + Number(el.getAttribute('data-len')), 1439));
      else $('imError').textContent = 'Set the start time first.';
      return;
    }
  });

  $('imSave').addEventListener('click', saveItem);
  $('imDelete').addEventListener('click', deleteItem);
  $('imDuplicate').addEventListener('click', duplicateItem);
  $('rotApply').addEventListener('click', applyRotation);
  $('shiftApply').addEventListener('click', applyShift);
  $('confirmOk').addEventListener('click', function () {
    var cb = confirmCb;
    confirmCb = null;
    closeModal('confirmModal');
    if (cb) cb();
  });
  $('statusBtn').addEventListener('click', function () {
    $('checksCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-ev')) {
      var key = t.getAttribute('data-ev'), v = t.value.trim();
      commit(function (data) { if (key === 'name' && !v) return; data.event[key] = v; });
      return;
    }
    if (t.hasAttribute('data-status')) {
      var sk = t.getAttribute('data-status'), sv = t.value.trim();
      commit(function (data) {
        var st = data.event.status || { state: '', minutes: 0, message: '', at: '' };
        if (sk === 'state') {
          if (!sv) { delete data.event.status; return; }
          if (sv === st.state) return;
          // A new state gets a new time. Track green starts with an empty message.
          st.at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
          if (sv === 'green') { st.message = ''; st.minutes = 0; }
          st.state = sv;
        } else if (sk === 'minutes') {
          st.minutes = Number(sv) || 0;
        } else {
          st.message = sv;
        }
        if (st.state) data.event.status = st;
      });
      return;
    }
    if (t.id === 'dayLabelInput') {
      var lv = t.value.trim();
      commit(function (data) { var d = T.dayById(data, state.dayId); if (d && lv) d.label = lv; });
      return;
    }
    if (t.id === 'dayDateInput') {
      var dv = t.value;
      commit(function (data) {
        var d = T.dayById(data, state.dayId);
        if (!d) return;
        var old = d.date;
        d.date = T.parseDate(dv) ? dv : '';
        var auto = d.label === weekdayOf(old) || /^Day \d+$/.test(d.label) || /^Copy of /.test(d.label);
        if (auto && d.date) d.label = weekdayOf(d.date);
      });
      return;
    }
    if (t.hasAttribute('data-gfield')) {
      editGroupField(t.closest('.group-row').getAttribute('data-gid'), t.getAttribute('data-gfield'), t.value);
      return;
    }
    if (t.id === 'imAll') { syncAllToggle(); return; }
    if (t.id === 'imKind') { updateTitleHint(); return; }
    if (t.hasAttribute('data-rcheck')) {
      rot.enabled[t.closest('li').getAttribute('data-rid')] = t.checked;
      updateRotPreview();
      return;
    }
    if (t.id === 'rotAvoid') { updateRotPreview(); return; }
  });

  document.addEventListener('input', function (e) {
    var id = e.target.id;
    if (id === 'rotStart' || id === 'rotLen' || id === 'rotGap' || id === 'rotCount') updateRotPreview();
    if (id === 'shiftFrom' || id === 'shiftBy') updateShiftPreview();
  });

  document.addEventListener('keydown', function (e) {
    var open = openModalId();
    if (e.key === 'Escape' && open) { closeModal(open); return; }
    var tag = (e.target.tagName || '').toLowerCase();
    if (open && e.key === 'Enter' && tag === 'input' && e.target.type !== 'checkbox' && e.target.type !== 'file') {
      e.preventDefault();
      if (open === 'itemModal') saveItem();
      else if (open === 'rotModal' && !$('rotApply').disabled) applyRotation();
      else if (open === 'shiftModal' && !$('shiftApply').disabled) applyShift();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('#gridWrap td[role="button"]')) {
      e.preventDefault();
      activateCell(e.target);
      return;
    }
    var mod = e.ctrlKey || e.metaKey;
    if (!mod || open || tag === 'input' || tag === 'textarea' || tag === 'select') return;
    var k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
  });

  window.addEventListener('beforeunload', function (e) {
    if (!state.storageOk && state.undo.length) { e.preventDefault(); e.returnValue = ''; }
  });

  render();
})();
