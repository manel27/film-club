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

Options: `--today YYYY-MM-DD` sets the date after which films count as
planned (default: today, or `today:` in the overrides file).

Exit codes: `0` ok, `1` bad input or overrides file, `3` duplicate films (the
message lists them; nothing is written for `import.json`).

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
  - `films`: one per row, with `legacy_sheet_row`, `screened_on`,
    `day_order`, `title`, `year_hint`, `kind` (`normal`, `democratico`,
    `cinema`, `maratona`), `assigned`, `turn_holder` (null for history),
    `is_easter_egg`, `scores_locked`, `is_planned`, `labels`, `source_url`,
    `tmdb_query` and `tmdb` (null until phase 4c);
  - `attendance`, `scores` (strings with two decimals) and `comments`
    (sheet notes, authored by "Sheet archive", `is_legacy: true`);
  - `fixes` (automatic fixes), `needs_decision`, `observations`,
    `overrides_applied`, `skipped_rows` and `counts`.
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
- No person tag: Maratona → `rules.maratona_default`; Cinema on a cinema
  colour → the "Cinema" profile; otherwise the person whose colour the title
  has, or a decision.
- Democrático rows keep the tagged person as `assigned` (the proposer of the
  winning film) with `turn_holder` null.
- Coloured person cell = present, whatever the colour (odd colours are
  listed). Scores accept `7`, `7.5` and `7,5`, and are rounded half-up to
  hundredths like `numeric(4,2)` (so `0.006` → `0.01`, listed). Scores outside
  0–10 need a decision unless the film is an easter egg, whose scores are
  kept and locked.
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
  Every applied override is listed in the preview.
- `expected` / `expected_notes`: counts for the sanity section, with
  optional explanations.
- `today`: the cut-off for planned films.

Unknown keys, unknown people and overrides that match zero or several rows
stop the run with an error, so a typo can't silently do nothing.

## TMDB (phase 4c)

Not part of this phase. Each film carries `tmdb_query` (`query`, `year`,
`language`, `alternative_queries` taken from the linked Wikipedia or
Letterboxd page) and `tmdb: null`. `migration/tmdb.py` has the hook:
`apply_matches(films, matcher)` fills `tmdb` with whatever the matcher
returns; after matching, run the duplicate check again on `tmdb_id`.

## Tests

```bash
python3 -I -m unittest discover -s migration/tests -t . -v
```

CI runs the same command in the `Migration parser tests (Python)` job.
