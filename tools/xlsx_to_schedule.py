#!/usr/bin/env python3
"""Convert a TSCC HPDE schedule spreadsheet (.xlsx) into data/schedule.js.

Expected layout (the layout used for the March 2026 schedule):

  * Day heading row: column A holds the day name ("Friday", "Saturday", ...).
  * Header row: column A is "Time". The following columns are run group names
    (Instructor, Green, Yellow, Purple, Blue) or a single "Event" column for
    days without group columns.
  * Schedule rows: column A is a time ("6:00") or a range ("8:30-8:55").
    Text in a group column is what that group does ("Track", "Classroom",
    "Check-In", ...). A cell merged across several group columns applies to
    all of those groups. A cell merged across every group column applies to
    everyone, unless its text names exactly one run group (for example
    "Instructor Meeting"), in which case it applies to that group only.

Times without AM/PM are resolved in order: a time earlier than the previous
start time in the same day is moved to the afternoon. "12:xx" is always noon.
Check the result in organizer.html. The Checks panel flags anything that
overlaps.

Usage:
  python3 tools/xlsx_to_schedule.py "March 2026 Schedule.xlsx" -o data/schedule.js \
      --name "Oak Tree Bowl VI HPDE" --track "VIR Full Course" \
      --dates 2026-03-06,2026-03-07,2026-03-08

Requires openpyxl (pip install openpyxl).
"""

import argparse
import datetime as dt
import json
import re
import sys
from collections import Counter

try:
    import openpyxl
except ImportError:  # pragma: no cover
    sys.exit("openpyxl is required: pip install openpyxl")

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

# TSCC's standard run groups. Header text is matched against name, level and aliases.
DEFAULT_GROUPS = [
    {"id": "white", "name": "White", "level": "Instructor", "color": "#7F7F7F", "tint": "#D9D9D9",
     "aliases": ["instructor", "instructors", "white"]},
    {"id": "green", "name": "Green", "level": "Novice", "color": "#538135", "tint": "#C5E0B3",
     "aliases": ["green", "novice"]},
    {"id": "yellow", "name": "Yellow", "level": "Intermediate", "color": "#FFC000", "tint": "#FFE599",
     "aliases": ["yellow", "intermediate"]},
    {"id": "purple", "name": "Purple", "level": "Upper Intermediate", "color": "#7030A0", "tint": "#DC9DF5",
     "aliases": ["purple", "upper intermediate"]},
    {"id": "blue", "name": "Blue", "level": "Advanced", "color": "#2E74B5", "tint": "#B4C6E7",
     "aliases": ["blue", "advanced"]},
]

EVENT_HEADERS = {"event", "events", "activity", "activities", "schedule"}


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "group"


def hex_fill(cell):
    """Return the cell's solid fill as #RRGGBB, or None."""
    fill = cell.fill
    if fill is None or fill.fill_type != "solid":
        return None
    color = fill.fgColor
    if color is None or color.type != "rgb" or not isinstance(color.rgb, str):
        return None
    rgb = color.rgb[-6:].upper()
    if rgb in ("000000", "FFFFFF"):
        return None
    return "#" + rgb


def lighten(hex_color, amount=0.7):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    mix = lambda c: round(c + (255 - c) * amount)
    return "#{:02X}{:02X}{:02X}".format(mix(r), mix(g), mix(b))


def to_minutes_24(value):
    return value.hour * 60 + value.minute


TIME_RE = re.compile(r"^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?\s*$", re.I)


def parse_clock(text):
    """Parse '8:30', '8', '5:30pm' -> (hour, minute, meridiem or None)."""
    m = TIME_RE.match(text)
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2) or 0)
    if hour > 23 or minute > 59:
        return None
    meridiem = m.group(3).lower() if m.group(3) else None
    return hour, minute, meridiem


def resolve(clock, floor):
    """Turn a parsed clock into minutes after midnight, at or after `floor` when ambiguous."""
    hour, minute, meridiem = clock
    if meridiem == "a":
        return (hour % 12) * 60 + minute
    if meridiem == "p":
        return (hour % 12 + 12) * 60 + minute
    if hour >= 13 or hour == 0:
        return hour * 60 + minute
    if hour == 12:
        return 12 * 60 + minute  # noon hour
    morning = hour * 60 + minute
    if floor is not None and morning < floor:
        return morning + 12 * 60
    return morning


def parse_time_cell(value, prev_start):
    """Return (start_minutes, end_minutes or None) for a time cell, or None if it isn't a time."""
    if isinstance(value, dt.datetime):
        value = value.time()
    if isinstance(value, dt.time):
        return to_minutes_24(value), None
    if not isinstance(value, str):
        return None
    parts = re.split(r"\s*(?:-|–|—|to)\s*", value.strip(), maxsplit=1)
    first = parse_clock(parts[0])
    if not first:
        return None
    # Tolerate a start slightly earlier than the previous one (overlapping rows) before assuming PM.
    floor = None if prev_start is None else prev_start - 60
    start = resolve(first, floor)
    end = None
    if len(parts) > 1:
        second = parse_clock(parts[1])
        if not second:
            return None
        end = resolve(second, start + 1)
    return start, end


def hhmm(minutes):
    if minutes is None:
        return ""
    minutes %= 24 * 60
    return "{:02d}:{:02d}".format(minutes // 60, minutes % 60)


def classify(text):
    t = text.lower()
    if re.match(r"^\s*(on\s+)?track\b", t):
        return "track"
    if re.search(r"check[\s-]?in", t):
        return "checkin"
    if re.search(r"\b(meeting|meetup|briefing)\b", t):
        return "meeting"
    if re.search(r"\b(lunch|break)\b", t):
        return "break"
    if "class" in t:
        return "classroom"
    return "general"


def split_text(text, kind):
    """Split 'Driver Meeting - Classroom (note)' into title, location, note."""
    text = re.sub(r"\s+", " ", text).strip()
    note = ""
    m = re.search(r"\(([^)]*)\)\s*$", text)
    if m:
        note = m.group(1).strip()
        text = text[:m.start()].strip()
    text = text.rstrip(",;:- ").strip()
    location = ""
    m = re.match(r"^(.*\S)\s+-\s+(\S+(?:\s\S+){0,2})$", text)
    if m:
        text, location = m.group(1).strip(), m.group(2).strip()
    if kind in ("track", "classroom", "checkin") and re.fullmatch(r"(on )?track|classroom|class|check[\s-]?in", text, re.I):
        text = ""
    return text, location, note


class GroupRegistry:
    def __init__(self):
        self.groups = []
        self.by_key = {}
        self.track_fills = {}

    def match(self, header):
        key = header.strip().lower()
        if key in self.by_key:
            return self.by_key[key]
        for g in DEFAULT_GROUPS:
            if key in g["aliases"] or key == g["name"].lower() or key == g["level"].lower():
                return self._add(key, dict(g))
        gid = slug(header)
        return self._add(key, {"id": gid, "name": header.strip(), "level": "", "color": "#6B7280",
                               "tint": "#E5E7EB", "aliases": []})

    def _add(self, key, group):
        existing = next((g for g in self.groups if g["id"] == group["id"]), None)
        if existing:
            self.by_key[key] = existing
            return existing
        self.groups.append(group)
        self.by_key[key] = group
        return group

    def named_in(self, text):
        """Groups whose name, level or alias appears as a word in text."""
        t = text.lower()
        hits = []
        for g in self.groups:
            words = {g["name"].lower(), g["level"].lower(), *g.get("aliases", [])} - {""}
            if any(re.search(r"\b" + re.escape(w) + r"s?\b", t) for w in words):
                hits.append(g["id"])
        return hits


def convert(path, sheet_name=None):
    wb = openpyxl.load_workbook(path)
    ws = wb[sheet_name] if sheet_name else wb.worksheets[0]

    merged_at = {}   # (row, col) of top-left -> (min_col, max_col)
    covered = set()  # cells hidden under a merge
    for rng in ws.merged_cells.ranges:
        merged_at[(rng.min_row, rng.min_col)] = (rng.min_col, rng.max_col)
        for r in range(rng.min_row, rng.max_row + 1):
            for c in range(rng.min_col, rng.max_col + 1):
                if (r, c) != (rng.min_row, rng.min_col):
                    covered.add((r, c))

    registry = GroupRegistry()
    track_fills = {}
    days = []
    day = None
    columns = {}      # column index -> group id, or "all" for an Event column
    prev_start = None
    warnings = []

    for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
        first = row[0]
        a = first.value
        if isinstance(a, str) and a.strip().split(" ")[0].lower() in WEEKDAYS:
            label = a.strip()
            base = label.split(" ")[0][:3].lower()
            day_id, n = base, 2
            while any(d["id"] == day_id for d in days):
                day_id, n = "{}{}".format(base, n), n + 1
            day = {"id": day_id, "label": label, "date": "", "items": []}
            days.append(day)
            columns, prev_start = {}, None
            continue
        if day is None:
            continue
        if isinstance(a, str) and a.strip().lower() == "time":
            columns = {}
            for cell in row[1:]:
                if not isinstance(cell.value, str) or not cell.value.strip():
                    continue
                header = cell.value.strip()
                if header.lower() in EVENT_HEADERS:
                    columns[cell.column] = "all"
                    continue
                group = registry.match(header)
                columns[cell.column] = group["id"]
                tint = hex_fill(cell)
                if tint:
                    group["tint"] = tint
            continue
        if a is None:
            continue
        times = parse_time_cell(a, prev_start)
        if times is None:
            warnings.append("Row {}: could not read time {!r}; row skipped".format(first.row, a))
            continue
        start, end = times
        prev_start = start
        group_cols = sorted(c for c, g in columns.items() if g != "all")
        for cell in row[1:]:
            if cell.value is None or (cell.row, cell.column) in covered:
                continue
            text = str(cell.value).strip()
            if not text:
                continue
            lo, hi = merged_at.get((cell.row, cell.column), (cell.column, cell.column))
            spanned = [columns[c] for c in range(lo, hi + 1) if c in columns]
            if not spanned:
                continue
            if "all" in spanned or (group_cols and set(range(lo, hi + 1)) >= set(group_cols) and len(group_cols) > 1):
                named = registry.named_in(text)
                groups = [named[0]] if len(named) == 1 else "all"
            else:
                groups = list(dict.fromkeys(spanned))
            kind = classify(text)
            title, location, note = split_text(text, kind)
            if kind == "track" and isinstance(groups, list) and len(groups) == 1:
                fill = hex_fill(cell)
                if fill:
                    track_fills.setdefault(groups[0], Counter())[fill] += 1
            day["items"].append({
                "id": "{}-{}".format(day["id"], len(day["items"]) + 1),
                "start": hhmm(start),
                "end": hhmm(end),
                "kind": kind,
                "title": title,
                "groups": groups,
                "location": location,
                "note": note,
            })

    for group in registry.groups:
        fills = track_fills.get(group["id"])
        if fills:
            group["color"] = fills.most_common(1)[0][0]
            if group["tint"] in ("#E5E7EB",):
                group["tint"] = lighten(group["color"])
        group.pop("aliases", None)

    return registry.groups, days, warnings


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx", help="schedule spreadsheet (.xlsx)")
    ap.add_argument("-o", "--output", default="data/schedule.js", help="output file (default data/schedule.js)")
    ap.add_argument("--sheet", help="worksheet name (default: first sheet)")
    ap.add_argument("--name", default="TSCC HPDE", help="event name")
    ap.add_argument("--track", default="", help="track and configuration")
    ap.add_argument("--timezone", default="America/New_York", help="IANA time zone of the track")
    ap.add_argument("--notice", default="", help="banner text shown at the top of the participant page")
    ap.add_argument("--dates", default="", help="comma-separated YYYY-MM-DD dates, one per day in sheet order")
    args = ap.parse_args(argv)

    groups, days, warnings = convert(args.xlsx, args.sheet)
    dates = [d.strip() for d in args.dates.split(",") if d.strip()]
    for day, date in zip(days, dates):
        day["date"] = date

    data = {
        "schemaVersion": 1,
        "updatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "event": {"name": args.name, "track": args.track, "timezone": args.timezone, "notice": args.notice},
        "groups": groups,
        "days": days,
    }
    body = json.dumps(data, indent=2, ensure_ascii=False)
    header = ("/* TSCC HPDE schedule data. Converted from {} by tools/xlsx_to_schedule.py.\n"
              "   Edit it with organizer.html, export, and commit the new file to publish. */\n").format(args.xlsx.split("/")[-1])
    with open(args.output, "w", encoding="utf-8") as fh:
        fh.write(header + "window.TSCC_SCHEDULE = " + body + ";\n")

    print("Wrote {}".format(args.output))
    for day in days:
        counts = Counter(g for it in day["items"] if it["kind"] == "track"
                         for g in (it["groups"] if isinstance(it["groups"], list) else [x["id"] for x in groups]))
        summary = ", ".join("{} {}".format(g["name"], counts.get(g["id"], 0)) for g in groups)
        print("  {:<10} {:>2} items | track sessions: {}".format(day["label"], len(day["items"]), summary))
    for w in warnings:
        print("  warning: " + w)


if __name__ == "__main__":
    main()
