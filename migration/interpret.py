"""Step 2: ``sheet.json`` -> ``import.json`` (plan §2.7, §4, §8).

Turns raw rows into the platform's tables: profiles, films (with kind,
assigned person, date, title, year hint), attendance, scores and legacy
comments. Every rule that changes or fills in data is recorded in ``fixes``;
anything the code can't decide on its own goes to ``needs_decision``;
informational findings go to ``observations``.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict
from decimal import Decimal
from typing import Any

from . import dupes, tmdb
from .config import Config, ConfigError, FilmOverride, Person
from .parse_sheet import is_coloured, normalise_colour
from .text import clean_spaces, fold, parse_link, parse_score, split_tags, title_norm, year_tag

IMPORT_FORMAT = "film-club-import/1"
MAX_COMMENT = 4000
MAX_SCORE = Decimal("10")

# Human labels for the rule ids used in fixes / needs_decision / observations.
RULES = {
    # automatic fixes
    "title_whitespace": "Stray spaces or line breaks removed from the title",
    "kind_tag_spelling": "Misspelt kind tag normalised",
    "tag_colour_fix": "Tag and colour disagree: configured correction applied",
    "maratona_default": "Untagged Maratona assigned to the default person",
    "cinema_system": "Untagged Cinema assigned to the Cinema system chooser",
    "assigned_by_colour": "No person tag: chooser taken from the title colour",
    "odd_attendance_colour": "Cell coloured with another colour: treated as present",
    "score_comma": "Decimal comma read as a decimal point",
    "score_rounded": "Score rounded to hundredths",
    "easter_egg_scores": "Scores above 10 kept and locked (easter egg)",
    "planned_film": "Future date: imported as a planned film",
    # needs decision
    "unknown_tag": "Unknown bracket tag",
    "several_person_tags": "Several person tags on one title",
    "several_kind_tags": "Several kind tags on one title",
    "tag_colour_mismatch": "Person tag and title colour disagree",
    "no_chooser": "No chooser could be determined",
    "cinema_member_colour": "Untagged Cinema on a member's colour",
    "maratona_member_colour": "Untagged Maratona on another member's colour",
    "bad_date": "Date can't be read",
    "bad_score": "Score can't be read",
    "score_out_of_range": "Score outside 0-10",
    "unknown_column": "Person column not in the roster",
    "comment_too_long": "Note longer than 4000 characters",
    "empty_title": "Row has no title",
    # observations
    "keyword_alias": "Secondary keyword used for a person",
    "chooser_absent": "Chooser not marked present",
    "proposer_absent": "Democrático proposer not marked present",
    "year_conflict": "Year tag and link year differ",
    "link_not_film": "Link doesn't point at a film page",
    "planned_has_data": "Planned film already has scores or attendance",
    "title_uncoloured": "Title cell has no colour",
    "average_mismatch": "Sheet average differs from the recomputed average",
    "stray_row": "Row without date or title but with other text: ignored",
}


class _Report:
    def __init__(self) -> None:
        self.fixes: list[dict[str, Any]] = []
        self.needs_decision: list[dict[str, Any]] = []
        self.observations: list[dict[str, Any]] = []

    @staticmethod
    def _entry(rule: str, row: dict[str, Any] | None, detail: str) -> dict[str, Any]:
        entry: dict[str, Any] = {"rule": rule, "label": RULES[rule], "detail": detail}
        if row is not None:
            entry.update(
                {
                    "row": row["sheet_row"],
                    "date": row.get("date"),
                    "title": clean_spaces(row.get("title_raw", "")),
                }
            )
        return entry

    def fix(self, rule: str, row: dict[str, Any] | None, detail: str) -> None:
        self.fixes.append(self._entry(rule, row, detail))

    def decide(self, rule: str, row: dict[str, Any] | None, detail: str) -> None:
        self.needs_decision.append(self._entry(rule, row, detail))

    def note(self, rule: str, row: dict[str, Any] | None, detail: str) -> None:
        self.observations.append(self._entry(rule, row, detail))


class _Roster:
    """Lookups over the configured people."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.by_name = {p.name: p for p in cfg.people}
        self.by_column = {p.column: p for p in cfg.people if p.column}
        self.by_keyword: dict[str, Person] = {}
        self.by_folded_keyword: dict[str, list[Person]] = defaultdict(list)
        for person in cfg.people:
            for keyword in person.keywords:
                if keyword in self.by_keyword and self.by_keyword[keyword] is not person:
                    raise ConfigError(f"keyword {keyword!r} is used by two people")
                self.by_keyword[keyword] = person
                self.by_folded_keyword[fold(keyword)].append(person)
        self.by_colour: dict[str, list[Person]] = defaultdict(list)
        for person in cfg.people:
            for colour in person.colours:
                self.by_colour[colour].append(person)

    def from_tag(self, tag: str) -> Person | None:
        if tag in self.by_keyword:
            return self.by_keyword[tag]
        found = self.by_folded_keyword.get(fold(tag), [])
        return found[0] if len(found) == 1 else None

    def from_colour(self, colour: str | None) -> Person | None:
        found = self.by_colour.get(colour or "", [])
        return found[0] if len(found) == 1 else None

    def owner_names(self, colour: str | None) -> str:
        names = [p.name for p in self.by_colour.get(colour or "", [])]
        return ", ".join(names) if names else "nobody in the roster"


def legacy_key(screened_on: str, title: str) -> str:
    """Stable identity of an imported film: ``"<screened_on>|<title_norm>"``.

    Unlike the sheet row number it doesn't shift when rows are added above.
    Attendance, scores and comments reference films by this key, and the
    import (phase 4c) upserts on it.
    """
    return f"{screened_on}|{title_norm(title)}"


def _kind_of(tag: str) -> tuple[str, bool] | None:
    """Return (kind, exact_spelling) for a kind tag, else None."""
    folded = fold(tag)
    if folded.startswith("democr"):
        return "democratico", folded == "democratico"
    if folded == "cinema":
        return "cinema", True
    if folded == "maratona":
        return "maratona", True
    return None


def _match_overrides(rows: list[dict[str, Any]], cfg: Config) -> dict[int, list[FilmOverride]]:
    """Map sheet row -> overrides; each override must match exactly one row."""
    result: dict[int, list[FilmOverride]] = defaultdict(list)
    for override in cfg.films:
        m = override.match
        hits = []
        for row in rows:
            if "row" in m and int(m["row"]) != row["sheet_row"]:
                continue
            if "date" in m and str(m["date"]) != row["date"].strip():
                continue
            if "title" in m and title_norm(str(m["title"])) != title_norm(split_tags(row["title_raw"])[0]):
                continue
            hits.append(row)
        if len(hits) != 1:
            raise ConfigError(f"films override {m} matches {len(hits)} rows (it must match exactly one)")
        result[hits[0]["sheet_row"]].append(override)
    return result


def interpret(sheet: dict[str, Any], cfg: Config, today: dt.date | None = None) -> dict[str, Any]:
    """Interpret parsed sheet data. Raises DuplicateFilmError on duplicates."""
    today = today or cfg.today or dt.date.today()
    report = _Report()
    roster = _Roster(cfg)
    cinema_name = cfg.cinema_profile["name"]
    archive_name = cfg.archive_profile["name"]
    cinema_colours = set(cfg.cinema_colours)

    for person in cfg.people:
        if not person.in_roster:
            report.decide(
                "unknown_column",
                None,
                f"column {person.column!r} isn't in the overrides file's people; "
                f"imported for now as a profile named {person.name!r} with keyword ({person.name})",
            )
    for stray in sheet.get("ignored_rows", []):
        report.note("stray_row", None, f"sheet row {stray['sheet_row']}, columns {stray['columns_with_text']}")

    overrides = _match_overrides(sheet["rows"], cfg)
    applied: list[dict[str, Any]] = []

    films: list[dict[str, Any]] = []
    attendance: list[dict[str, Any]] = []
    scores: list[dict[str, Any]] = []
    comments: list[dict[str, Any]] = []
    raw_counts = Counter()
    skipped_rows: list[int] = []

    for row in sheet["rows"]:
        raw_counts["rows"] += 1
        cells = row["people"]
        raw_counts["score_cells"] += sum(1 for c in cells.values() if c["text"].strip())
        raw_counts["present_cells"] += sum(1 for c in cells.values() if c["coloured"])
        raw_counts["notes"] += bool(row["notes"])
        raw_counts["links"] += bool(row["link"])

        sets: dict[str, Any] = {}
        for override in overrides.get(row["sheet_row"], []):
            sets.update(override.set)
            applied.append(
                {
                    "row": row["sheet_row"],
                    "date": row["date"],
                    "title": clean_spaces(row["title_raw"]),
                    "set": {k: v for k, v in override.set.items() if k != "reason"},
                    "reason": override.reason or override.set.get("reason", ""),
                }
            )
        if sets.get("exclude"):
            skipped_rows.append(row["sheet_row"])
            continue

        # Date
        date_text = str(sets.get("date", row["date"])).strip()
        try:
            screened_on = dt.date.fromisoformat(date_text)
        except ValueError:
            report.decide("bad_date", row, f"date text {date_text!r}; row skipped")
            skipped_rows.append(row["sheet_row"])
            continue

        # Title and tags
        if clean_spaces(row["title_raw"]) != row["title_raw"]:
            report.fix("title_whitespace", row, f"{row['title_raw']!r} -> {clean_spaces(row['title_raw'])!r}")
        title, tags = split_tags(row["title_raw"])
        if not title:
            report.decide("empty_title", row, "row skipped")
            skipped_rows.append(row["sheet_row"])
            continue

        kinds: list[str] = []
        person_tags: list[tuple[str, Person]] = []
        labels: list[str] = []
        tag_year: int | None = None
        for tag in tags:
            kind = _kind_of(tag)
            if kind:
                kinds.append(kind[0])
                if not kind[1]:
                    report.fix("kind_tag_spelling", row, f"({tag}) read as {kind[0]}")
                continue
            if year_tag(tag) is not None:
                tag_year = year_tag(tag)
                continue
            if tag in cfg.ignore_tags:
                labels.append(tag)
                continue
            person = roster.from_tag(tag)
            if person:
                person_tags.append((tag, person))
                if tag != person.keywords[0]:
                    report.note("keyword_alias", row, f"({tag}) -> {person.name}")
                continue
            report.decide("unknown_tag", row, f"({tag}) is not a person keyword, kind or year; ignored")

        if len(set(kinds)) > 1:
            report.decide("several_kind_tags", row, f"{kinds}; using {kinds[0]}")
        kind = sets.get("kind") or (kinds[0] if kinds else "normal")

        # Year hint and link
        link = parse_link(row["link"])
        year_hint = sets.get("year", tag_year if tag_year is not None else (link.year if link else None))
        if tag_year and link and link.year and tag_year != link.year:
            report.note("year_conflict", row, f"tag {tag_year}, link {link.year}; using {year_hint}")
        if link and not link.is_film_page:
            report.note("link_not_film", row, f"{link.url} ({link.disambiguator})")

        # Assigned person
        colour = normalise_colour(row["title_colour"])
        auto = _Report()
        assigned: str | None = None
        if len({p.name for _, p in person_tags}) > 1:
            auto.decide(
                "several_person_tags", row, f"{[t for t, _ in person_tags]}; using the first ({person_tags[0][1].name})"
            )
        if person_tags:
            tag, person = person_tags[0]
            assigned = person.name
            acceptable = set(person.colours)
            if kind == "cinema":
                acceptable |= cinema_colours
            if kind in ("cinema", "maratona"):
                acceptable.add(None)
            shown = colour if is_coloured(colour) else None
            if shown not in acceptable:
                fix = next((f for f in cfg.tag_colour_fixes if f.tag == tag and f.colour == colour), None)
                if fix:
                    assigned = fix.person
                    auto.fix(
                        "tag_colour_fix",
                        row,
                        f"({tag}) on {colour} -> {fix.person}" + (f" ({fix.reason})" if fix.reason else ""),
                    )
                elif shown is None:
                    auto.note("title_uncoloured", row, f"({tag}) -> {person.name}")
                else:
                    auto.decide(
                        "tag_colour_mismatch",
                        row,
                        f"({tag}) = {person.name} {person.colour}, but the cell is {colour} "
                        f"({roster.owner_names(colour)}); kept {person.name}",
                    )
        elif kind == "maratona":
            owner = roster.from_colour(colour) if is_coloured(colour) else None
            if owner and owner.name != cfg.maratona_default:
                auto.decide(
                    "maratona_member_colour",
                    row,
                    f"untagged Maratona on {colour}, which is {owner.name}'s colour: "
                    f"{owner.name} or {cfg.maratona_default or 'the default person'}?",
                )
            elif cfg.maratona_default:
                assigned = cfg.maratona_default
                auto.fix("maratona_default", row, f"-> {assigned}")
            else:
                auto.decide("no_chooser", row, "untagged Maratona and no rules.maratona_default")
        elif kind == "cinema" and (colour in cinema_colours or not is_coloured(colour)):
            assigned = cinema_name
            auto.fix("cinema_system", row, f"{colour} -> {cinema_name}")
        elif kind == "cinema" and roster.by_colour.get(colour or ""):
            auto.decide(
                "cinema_member_colour",
                row,
                f"untagged Cinema on {colour}, which is {roster.owner_names(colour)}'s colour: "
                f"that person or the {cinema_name} chooser?",
            )
        else:
            person = roster.from_colour(colour) if is_coloured(colour) else None
            if person:
                assigned = person.name
                auto.fix("assigned_by_colour", row, f"{colour} -> {person.name}")
            else:
                auto.decide("no_chooser", row, f"no person tag and the colour {colour} is {roster.owner_names(colour)}")
        if sets.get("assigned"):
            # An explicit override settles it: whatever the rules found about
            # the chooser no longer applies (the override itself is listed).
            assigned = sets["assigned"]
            auto = _Report()
        report.fixes += auto.fixes
        report.needs_decision += auto.needs_decision
        report.observations += auto.observations

        is_egg = bool(sets.get("easter_egg"))
        is_planned = screened_on > today
        if is_planned:
            report.fix("planned_film", row, f"{screened_on} is after {today}")

        film_ref = row["sheet_row"]
        present: set[str] = set()
        film_scores: dict[str, Decimal] = {}
        egg_scores = 0
        for column, cell in cells.items():
            person = roster.by_column[column]
            if cell["coloured"]:
                present.add(person.name)
                if cell["colour"] not in person.colours:
                    report.fix(
                        "odd_attendance_colour",
                        row,
                        f"{person.name}: {cell['colour']} ({roster.owner_names(cell['colour'])})",
                    )
            parsed = parse_score(cell["text"])
            if parsed is None:
                continue
            if parsed.error:
                report.decide("bad_score", row, f"{person.name}: {parsed.raw!r} ({parsed.error}); not imported")
                continue
            assert parsed.value is not None
            if parsed.comma:
                report.fix("score_comma", row, f"{person.name}: {parsed.raw.strip()!r} -> {parsed.value}")
            if parsed.rounded:
                report.fix("score_rounded", row, f"{person.name}: {parsed.exact} -> {parsed.value}")
            if parsed.value < 0 or parsed.value > MAX_SCORE:
                if is_egg:
                    egg_scores += 1
                else:
                    report.decide(
                        "score_out_of_range", row, f"{person.name}: {parsed.value}; not imported"
                    )
                    continue
            film_scores[person.name] = parsed.value

        for name, value in (sets.get("present") or {}).items():
            if name not in roster.by_name:
                raise ConfigError(f"row {film_ref}: present override for unknown person {name!r}")
            (present.add if value else present.discard)(name)
        for name, value in (sets.get("scores") or {}).items():
            if name not in roster.by_name:
                raise ConfigError(f"row {film_ref}: score override for unknown person {name!r}")
            if value is None:
                film_scores.pop(name, None)
            elif (value < 0 or value > MAX_SCORE) and not is_egg:
                raise ConfigError(f"row {film_ref}: score override {name} = {value} is outside 0-10")
            else:
                film_scores[name] = value
        if egg_scores:
            report.fix("easter_egg_scores", row, f"{egg_scores} scores above 10 kept; lock after inserting scores")
        if is_planned and (present or film_scores):
            report.note("planned_has_data", row, f"{len(present)} present, {len(film_scores)} scores")
        if (
            kind == "normal"
            and assigned
            and assigned in roster.by_name
            and roster.by_name[assigned].column
            and assigned not in present
            and not is_planned
        ):
            report.note("chooser_absent", row, f"{assigned} chose but isn't marked present")
        if (
            kind == "democratico"
            and not is_egg
            and assigned
            and assigned in roster.by_name
            and roster.by_name[assigned].column
            and assigned not in present
        ):
            report.note("proposer_absent", row, f"{assigned} is the tagged proposer but isn't marked present")

        # Cross-check the sheet's own average (column Média; not imported).
        avg_raw = row.get("average_raw", "")
        avg = parse_score(avg_raw) if avg_raw else None
        if film_scores and avg and avg.value is not None and not is_egg:
            exact = [parse_score(c["text"]) for c in cells.values()]
            values = [p.exact for p in exact if p and p.exact is not None]
            mean = sum(values, Decimal(0)) / len(values) if values else None
            raw_counts["averages_checked"] += mean is not None
            if mean is not None and abs(mean - avg.value) > Decimal("0.006"):
                raw_counts["average_mismatches"] += 1
                report.note("average_mismatch", row, f"sheet {avg.value}, recomputed {mean:.2f}")

        final_title = sets.get("title", title)
        key = legacy_key(screened_on.isoformat(), final_title)
        film = {
            "legacy_key": key,
            "legacy_sheet_row": film_ref,
            "screened_on": screened_on.isoformat(),
            "day_order": None,
            "title": final_title,
            "title_raw": row["title_raw"],
            "title_norm": title_norm(final_title),
            "year_hint": year_hint,
            "kind": kind,
            "assigned": assigned,
            "turn_holder": sets.get("turn_holder"),
            "is_easter_egg": is_egg,
            # Always false at insert: the import inserts the scores first and
            # only then locks the film (see lock_after_scores, plan §4.4).
            "scores_locked": False,
            "is_planned": is_planned,
            "labels": labels,
            "title_colour": colour,
            "source_url": row["link"],
            "tmdb_query": tmdb.build_query(final_title, year_hint, link),
            "tmdb": None,
        }
        if film["turn_holder"] and kind != "democratico":
            raise ConfigError(f"row {film_ref}: turn_holder is only allowed on democratico films")
        films.append(film)
        attendance += [{"film": key, "profile": name} for name in sorted(present)]
        scores += [
            {"film": key, "profile": name, "score": f"{value:.2f}", "entered_by": archive_name}
            for name, value in sorted(film_scores.items())
        ]
        if row["notes"]:
            body = row["notes"]
            if len(body) > MAX_COMMENT:
                report.decide("comment_too_long", row, f"{len(body)} characters; not imported")
            else:
                comments.append(
                    {
                        "film": key,
                        "author": archive_name,
                        "body": body,
                        "is_legacy": True,
                        "created_at": screened_on.isoformat(),
                    }
                )

    # Order within a day: the sheet lists newest first, so a lower row is earlier.
    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for film in films:
        by_day[film["screened_on"]].append(film)
    for same_day in by_day.values():
        for order, film in enumerate(sorted(same_day, key=lambda f: -f["legacy_sheet_row"]), start=1):
            film["day_order"] = order

    films.sort(key=lambda f: (f["screened_on"], f["day_order"]))
    dupes.assert_no_duplicates(films)
    key_counts = Counter(f["legacy_key"] for f in films)
    clashing = [[f for f in films if f["legacy_key"] == k] for k, n in key_counts.items() if n > 1]
    if clashing:  # same date and title: already a duplicate, but be explicit
        raise dupes.DuplicateFilmError(clashing)

    used = {f["assigned"] for f in films} | {a["profile"] for a in attendance}
    profiles = [
        {
            "display_name": p.name,
            "sheet_keyword": p.keywords[0],
            "keywords": p.keywords,
            "colour": p.colour,
            "role": p.role,
            "is_system": False,
            "sheet_column": p.column,
            "has_history": p.name in used or any(s["profile"] == p.name for s in scores),
        }
        for p in cfg.people
    ]
    for system in (cfg.cinema_profile, cfg.archive_profile):
        profiles.append(
            {
                "display_name": system["name"],
                "sheet_keyword": None,
                "keywords": [],
                "colour": system["colour"],
                "role": "member",
                "is_system": True,
                "sheet_column": None,
                "has_history": True,
            }
        )

    kinds_count = Counter(f["kind"] for f in films)
    counts = {
        "sheet_rows": raw_counts["rows"],
        "films": len(films),
        "films_shown": sum(1 for f in films if not f["is_planned"]),
        "films_planned": sum(1 for f in films if f["is_planned"]),
        "rows_skipped": len(skipped_rows),
        "score_cells": raw_counts["score_cells"],
        "scores": len(scores),
        "present_cells": raw_counts["present_cells"],
        "attendance": len(attendance),
        "notes": raw_counts["notes"],
        "comments": len(comments),
        "links": raw_counts["links"],
        "averages_checked": raw_counts["averages_checked"],
        "average_mismatches": raw_counts["average_mismatches"],
        "kinds": dict(sorted(kinds_count.items())),
        "easter_egg_films": sum(1 for f in films if f["is_easter_egg"]),
        "duplicates": 0,
        "profiles": sum(1 for p in profiles if not p["is_system"]),
        "system_profiles": sum(1 for p in profiles if p["is_system"]),
        "fixes": len(report.fixes),
        "needs_decision": len(report.needs_decision),
    }

    return {
        "format": IMPORT_FORMAT,
        "source": sheet.get("source", {}),
        "today": today.isoformat(),
        "profiles": profiles,
        "films": films,
        "attendance": attendance,
        "scores": scores,
        "comments": comments,
        # Set films.scores_locked = true for these only after their scores
        # are inserted (the lock trigger refuses score changes afterwards).
        "lock_after_scores": [f["legacy_key"] for f in films if f["is_easter_egg"]],
        "fixes": report.fixes,
        "needs_decision": report.needs_decision,
        "observations": report.observations,
        "overrides_applied": applied,
        "skipped_rows": skipped_rows,
        "counts": counts,
        "expected": cfg.expected,
        "expected_notes": cfg.expected_notes,
    }
