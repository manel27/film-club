# Sheet migration (phase 4a: parse, interpret, preview)

Turns the club's Google Sheet export (File → Download → Web page, HTML)
into data shaped like the platform's tables, plus a readable preview for the
owner to approve. **Nothing is imported into the database in this phase.**

Real data never enters the repository:

- the sheet export stays where it was downloaded and is read in place;
- `migration/out/` (all outputs) and `migration/overrides.yaml` (real names)
  are git-ignored;
- the tests use a small synthetic fixture with made-up names, colours and
  titles (`tests/fixtures/sheet.html`).

## Requirements

Python 3.10+ and PyYAML (only for the overrides file):

```bash
python3 -m pip install -r migration/requirements.txt   # or: sudo apt install python3-yaml
```

## Running

The export is untrusted data. It is only read as text with Python's
`html.parser`; nothing in it is executed. Run Python in isolated mode (`-I`),
which keeps the current directory and environment variables out of the import
path. Because `-I` also drops the script's own directory, use the small
launcher `migration/run.py`, which adds only the repository root:

```bash
python3 -I migration/run.py all \
  --sheet "/path/to/the/export.html" \
  --out migration/out \
  --overrides migration/overrides.yaml
```

Steps can also run one at a time (`interpret` and `preview` read the previous
step's output from `--out`):

| Step        | Reads                       | Writes                       |
| ----------- | --------------------------- | ---------------------------- |
| `parse`     | `--sheet`                   | `sheet.json`                 |
| `interpret` | `sheet.json`, `--overrides` | `import.json`                |
| `preview`   | `import.json`               | `preview.html`, `preview.md` |
| `all`       | all of the above            | all of the above             |

Options: `--today YYYY-MM-DD` sets the "as of" date; films after it count
as planned. It overrides `today:` in the overrides file; with neither, the
current date is used. Set `today:` in the overrides file to make runs
reproducible: the same sheet and overrides then give byte-identical outputs.
The preview header shows the "as of" date.

`--out` must be `migration/out/` (git-ignored) or a folder outside the
repository; any other path inside the repo is refused, so real data can't end
up somewhere it could be committed.

**Failed runs leave no stale outputs.** Each file is written to a temporary
file in `--out` and moved into place (`os.replace`) only when its step
succeeds. When a step fails, its outputs and everything downstream are
deleted from `--out`: a failed `parse` removes all four files, a failed
`interpret` removes `import.json` and `preview.*` (keeping `sheet.json`),
a failed `preview` removes `preview.*`.

Exit codes: `0` ok; `1` bad input, overrides file, `--today` or `--out`
(one `error:` line, no traceback); `3` duplicate films (the message lists
them).

## Outputs (in `--out`, git-ignored)

- **`sheet.json`**: a faithful copy of the sheet, uninterpreted. One record
  per row: sheet row number, date text, raw title, title link, title cell
  colour, notes, the Média text, and for every person column the raw text,
  the cell colour and whether it is coloured (`coloured` = not empty and not
  the white/grey banding).
- **`import.json`**: the data to import, shaped after the plan's tables
  (§4.2):
  - `profiles`: the roster plus the system profiles "Cinema" and
    "Sheet archive" (`is_system: true`);
  - `films`: one per row, with `legacy_key`, `legacy_sheet_row`,
    `screened_on`, `day_order`, `title`, `year_hint`, `kind` (`normal`,
    `democratico`, `cinema`, `maratona`), `assigned`, `turn_holder` (null
    for history), `is_easter_egg`, `scores_locked` (always false here; see
    below), `is_planned`, `labels`, `source_url`, `tmdb_query` and `tmdb`
    (null until phase 4c);
  - `attendance`, `scores` (strings with two decimals) and `comments`
    (sheet notes, authored by "Sheet archive", `is_legacy: true`,
    `created_at` = the film's `screened_on`). Each row's `film` is the
    film's `legacy_key`;
  - `lock_after_scores`: the `legacy_key`s of the easter-egg films to lock;
  - `fixes` (automatic fixes), `needs_decision`, `observations`,
    `overrides_applied`, `skipped_rows` and `counts`.

  **Film identity.** `legacy_key` is `"<screened_on>|<normalised title>"`
  (after overrides), unique per film and independent of the sheet's row
  numbers, which shift whenever a row is added at the top. Attendance,
  scores and comments reference films by it, and the import (phase 4c)
  **upserts on `legacy_key`**. `legacy_sheet_row` is information only.

  **Easter-egg lock order (plan §4.4).** The import must **insert the
  scores first, then lock**: insert the film with `scores_locked = false`,
  insert its scores (the trigger only accepts values above 10 while the
  easter-egg film is unlocked), then set `scores_locked = true` for every
  film in `lock_after_scores`. After that, nobody can change those scores.

- **`preview.html`** / **`preview.md`**: the report for the owner: needs
  decision, sanity counts against `expected`, per-person totals with colour
  swatches, every automatic fix, every film (date, kind, assigned, present,
  scores, notes) and observations. The HTML is a single self-contained file
  with no scripts.

## How rows are interpreted

- Trailing bracket groups in a title are tags: kinds (`Democrático`, also
  misspelt, `Cinema`, `Maratona`), four-digit years (a year hint, not part
  of the title), labels listed in `rules.ignore_tags`, and person keywords.
  Anything else needs a decision.
- **The tag decides who chose; the title colour cross-checks it.** A
  mismatch is fixed only by a `rules.tag_colour_fixes` entry; otherwise it
  needs a decision.
- No person tag: Maratona → `rules.maratona_default`, unless the title has
  another member's colour (then it needs a decision); Cinema on a cinema
  colour or no colour → the "Cinema" profile, on a member's colour → a
  decision; otherwise the person whose colour the title has, or a decision.
- A sheet column that isn't in the overrides file's `people` needs a
  decision; until then its data is kept under a profile named after the
  column.
- Democrático rows keep the tagged person as `assigned` (the proposer of the
  winning film) with `turn_holder` null.
- Coloured person cell = present, whatever the colour (odd colours are
  listed). Scores accept `7`, `7.5` and `7,5`, and are rounded half-up to
  hundredths like `numeric(4,2)` (so `0.006` → `0.01`, listed). Scores outside
  0–10 need a decision unless the film is an easter egg, whose scores are
  kept and locked after insertion.
- Same-day films get `day_order` from the sheet order (lower row = earlier).
- The Média column is not imported; it is only used to cross-check the
  recomputed average.
- **Duplicates fail the run** (plan §4.3): same normalised title with the same
  or an unknown year hint, or the same link. Give each film its year in the
  overrides file to tell them apart.

## The overrides file

`migration/overrides.yaml` holds everything specific to the real sheet: the
roster (names, keywords, colours, roles), colour rules, per-film corrections
and the expected sanity counts. Its format is documented, with made-up
values, in [`overrides.example.yaml`](overrides.example.yaml); the tests run
the fixture against that example. Sections:

- `people`: `name`, `keywords`, optional `column`, `colour`, `alt_colours`
  and `role`. Only people listed here (plus any sheet column not listed)
  get a profile.
- `system_profiles`: names and colours of "Cinema" and "Sheet archive".
- `rules`: `cinema_colours`, `maratona_default`, `ignore_tags`,
  `tag_colour_fixes` (`tag` + `colour` → `person`, with a `reason`).
- `films`: corrections. `match` (any of `row`, `date`, `title`) must hit
  exactly one row; `set` may contain `title`, `year`, `kind`, `assigned`,
  `turn_holder`, `date`, `exclude`, `easter_egg`, `present` and `scores`.
  Score values are read exactly like sheet cells (`7,5` works; rounded
  half-up to hundredths) and must be 0–10 unless the film is an easter egg;
  `null` removes a score. Setting `assigned` replaces whatever the rules
  decided about the chooser, so those automatic fixes and decisions are
  dropped. Every applied override is listed in the preview.
- `expected` / `expected_notes`: counts for the sanity section, with
  optional explanations.
- `today`: the cut-off for planned films.

Malformed YAML, wrongly typed values, unknown keys, unknown people and
overrides that match zero or several rows stop the run with an `error:`
line, so a typo can't silently do nothing.

## TMDB (phase 4c)

Not part of this phase. Each film carries `tmdb_query` (`query`, `year`,
`language`, `alternative_queries` taken from the linked Wikipedia or
Letterboxd page) and `tmdb: null`, built by `migration/tmdb.py`. Phase 4c
runs the searches, fills `tmdb` and re-runs the duplicate check on
`tmdb_id`.

## Tests

```bash
python3 -I -m unittest discover -s migration/tests -t . -v
```

CI runs the same command in the `Migration parser tests (Python)` job.
