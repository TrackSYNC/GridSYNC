# GridSYNC

Run schedule for Tidewater Sports Car Club HPDE events. Two static pages, no server, no build step, hosted on GitHub Pages. The look follows the TSCC Track Event Tech Inspection form.

The live site is at https://tracksync.github.io/GridSYNC/ and the builder at https://tracksync.github.io/GridSYNC/organizer.html.

- **`index.html`, participant view.** The schedule by day, filtered to one run group or all of them, as a timeline or the familiar grid. On event days a "Right Now" card shows who is on track, who is next, and the selected group's next session. Finished time slots fold away so the current one is at the top. An open page checks for a newly published schedule every minute and redraws with a "Schedule updated" banner. Prints one page per day.
- **`organizer.html`, schedule builder.** Edit the grid, fill a session rotation, shift times when the day runs late, and see conflicts as you work. Exports `data/schedule.js`, which is the file you commit to publish.

## Files

```
index.html                  participant page
organizer.html              organizer page
data/schedule.js            the published schedule, the only file that changes per event
assets/styles.css           shared theme (tokens and components from the tech inspection form)
assets/schedule-core.js     shared logic: times, checks, grid rendering, import and export
assets/participant.js       participant page behavior
assets/organizer.js         organizer page behavior
assets/tscc-logo.png        club logo, not included yet (see "Add the logo")
assets/gridsync-logo.png    GridSync by TrackStack badge in the page footers
tools/xlsx_to_schedule.py   converts the club's spreadsheet layout into data/schedule.js
tests/                      unit tests, converter tests, browser tests
```

## Put it on GitHub Pages

1. Create a public repository under the GitHub account or organization that will own the site. This one is `TrackSYNC/GridSYNC`.
2. Upload the contents of this folder with the folder structure intact. On github.com that is **Add file**, then **Upload files**, drag everything in, and commit.
3. Open **Settings**, then **Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick the `main` branch and the `/ (root)` folder, and click **Save**.
4. The site appears at `https://<account>.github.io/<repository>/`. The builder is at `https://<account>.github.io/<repository>/organizer.html`.

GitHub Free only serves Pages from public repositories. Private repositories need GitHub Pro, Team or Enterprise. Everything in this repository is safe to make public: the schedule holds times and run groups, not names, phone numbers or car details. Keep registration exports out of the repository. The `.gitignore` already blocks spreadsheets and CSV files.

## Add the logo

Both pages load `assets/tscc-logo.png` and show a text "TSCC" mark until that file exists. The logo embedded in the tech inspection form is damaged: the bottom 40% of its image data is missing, so the letters are cut off. Use a clean copy of the club logo, ideally a PNG with a transparent background at least 36 px tall.

## Publish a schedule change

This repository is public, and every commit made on github.com records the uploader's commit email in its history. Before your first upload, open **Settings** on GitHub, then **Emails**, and check **Keep my email addresses private**. GitHub then records a no-reply address for your web uploads.

1. Open `organizer.html` on the live site.
2. Make the changes. The draft saves in your browser after every edit. Fix anything the **Checks** panel flags.
3. Click **Preview participant page** to see the draft the way participants will.
4. Click **Export schedule.js**.
5. In the repository, open the `data` folder, choose **Add file**, then **Upload files**, drop in `schedule.js`, and commit. It replaces the old file.
6. GitHub Pages republishes the site, usually within a few minutes. GitHub says it can take up to 10.

Anyone can open the organizer page, but it cannot change the live schedule on its own. Only people with write access to the repository can publish.

### Organizer tools

- **Click a block** to edit it. **Click an empty cell** to add something for that run group at that time.
- **Fill rotation** adds track sessions in a repeating group order from a start time, with a session length, gap and count. It skips past lunch, anything for everyone, and existing track sessions.
- **Shift times** moves every item from a given time onward by a number of minutes. Negative numbers move items earlier.
- **Duplicate day** copies a day, for example Saturday into Sunday. **Add day** continues the date sequence.
- **Undo and redo** cover every change (Ctrl+Z and Ctrl+Shift+Z, or Cmd on a Mac).
- **Load a schedule file** opens any exported `schedule.js`, for example last year's event as a starting point.

### What the Checks panel catches

- A run group booked for two things at once, such as a track session during lunch.
- Two different groups on track at the same time.
- Missing or backwards times, items with no run group, and track sessions with no end time.
- An uneven number of track sessions per group on a day.

## Participant links

| Link | Opens |
| --- | --- |
| `index.html?group=green` | with a run group selected. Works well as a QR code on the paddock board. |
| `index.html?day=sat` | a specific day |
| `index.html?view=grid` | the grid instead of the timeline |
| `index.html?now=10:05` | the Right Now card previewed at 10:05 on the day shown |
| `index.html?now=2026-03-07T10:05` | the Right Now card previewed at a specific date and time |
| `index.html?draft=1` | the organizer's unpublished draft from the same browser |

The Right Now card appears on its own when today's date, in the time zone set under Event Details, matches one of the event days. It refreshes every 20 seconds and when a phone wakes up.

## Convert an existing spreadsheet

`tools/xlsx_to_schedule.py` reads the layout the club already uses: a row with the day name, a "Time" header row with one column per run group, and cells such as "Track", "Classroom" and "Check-In". A merged cell applies to every group it spans. A full-width merged cell that names one group, such as "Instructor Meeting", applies to that group only. Times without AM or PM are read in order, so "1:10" after "11:45" becomes 1:10 PM.

```
pip install openpyxl
python3 tools/xlsx_to_schedule.py "March 2026 Schedule.xlsx" -o data/schedule.js \
  --name "Oak Tree Bowl VI HPDE" --track "VIR Full Course" \
  --dates 2026-03-06,2026-03-07,2026-03-08
```

Open the organizer page afterward and review the Checks panel.

## Sample data

`data/schedule.js` currently holds `Copy of March 2026 Schedule.xlsx` after conversion, matched to Oak Tree Bowl VI HPDE at VIR Full Course (Saturday, March 7 to Sunday, March 8, 2026, per the MotorsportReg listing). The "Instructor" column in the sheet is the White run group. The Saturday afternoon in that sheet has two problems the builder flags: a Green session at 12:30 that overlaps lunch until 12:45, and only three sessions each for White and Yellow while every other group has four. Sunday is clean.

## Data format

`data/schedule.js` assigns one object to `window.TSCC_SCHEDULE`. It is a `.js` file instead of `.json` so the pages also work when opened straight from a downloaded copy, where browsers block loading local JSON.

```js
window.TSCC_SCHEDULE = {
  "schemaVersion": 1,
  "updatedAt": "2026-09-25T21:16:00Z",
  "event": { "name": "...", "track": "...", "timezone": "America/New_York", "notice": "..." },
  "groups": [
    { "id": "green", "name": "Green", "level": "Novice", "color": "#538135", "tint": "#C5E0B3" }
  ],
  "days": [
    {
      "id": "sat", "label": "Saturday", "date": "2026-03-07",
      "items": [
        { "id": "sat-12", "start": "09:45", "end": "10:10", "kind": "track",
          "title": "", "groups": ["green"], "location": "", "note": "" }
      ]
    }
  ]
};
```

- `kind` is one of `track`, `classroom`, `checkin`, `meeting`, `break`, `general`.
- `groups` is a list of group ids, or `"all"` for everyone.
- Times are 24-hour `HH:MM` in the track's local time. `end` can be empty for moments such as "Gates Open".
- `color` fills track blocks. `tint` fills classroom and check-in blocks and the grid header.

## Tests

```
node --test tests/core.test.js           # core logic
python3 -m unittest discover -s tests    # spreadsheet converter (needs openpyxl)
npm install && npx playwright install chromium
python3 -m http.server 8765 & node tests/e2e.js   # both pages in a real browser
```

The tests use `tests/fixtures/march-2026-schedule.js`, so publishing a new `data/schedule.js` does not break them.
