"""Load and validate the overrides file (``migration/overrides.yaml``).

The file holds everything that is specific to the real sheet: the people
roster (names, sheet keywords, colours), the colour rules, per-film
corrections and the expected sanity counts. It is git-ignored because it holds
real names; ``migration/overrides.example.yaml`` documents the format.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

from decimal import Decimal

from .parse_sheet import normalise_colour
from .text import parse_score

FILM_SET_FIELDS = {
    "title",
    "year",
    "kind",
    "assigned",
    "turn_holder",
    "date",
    "exclude",
    "easter_egg",
    "present",
    "scores",
    "reason",
}
KINDS = ("normal", "democratico", "cinema", "maratona")
DEFAULT_CINEMA_PROFILE = {"name": "Cinema", "colour": "#34a853"}
DEFAULT_ARCHIVE_PROFILE = {"name": "Sheet archive", "colour": "#999999"}


class ConfigError(ValueError):
    """The overrides file is malformed."""


@dataclass
class Person:
    name: str
    keywords: list[str]
    colour: str | None
    column: str | None = None
    role: str = "member"
    alt_colours: list[str] = field(default_factory=list)
    in_roster: bool = True  # False: a sheet column the overrides file doesn't list

    @property
    def colours(self) -> set[str]:
        return {c for c in [self.colour, *self.alt_colours] if c}


@dataclass
class TagColourFix:
    tag: str
    colour: str
    person: str
    reason: str = ""


@dataclass
class FilmOverride:
    match: dict[str, Any]
    set: dict[str, Any]
    reason: str = ""


@dataclass
class Config:
    people: list[Person] = field(default_factory=list)
    cinema_profile: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_CINEMA_PROFILE))
    archive_profile: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_ARCHIVE_PROFILE))
    cinema_colours: list[str] = field(default_factory=list)
    maratona_default: str | None = None
    tag_colour_fixes: list[TagColourFix] = field(default_factory=list)
    ignore_tags: list[str] = field(default_factory=list)
    films: list[FilmOverride] = field(default_factory=list)
    expected: dict[str, int] = field(default_factory=dict)
    expected_notes: dict[str, str] = field(default_factory=dict)
    today: dt.date | None = None
    tmdb: dict[str, dict[str, Any]] = field(default_factory=dict)  # legacy_key -> {tmdb_id} | {no_tmdb, year}

    def person(self, name: str) -> Person | None:
        return next((p for p in self.people if p.name == name), None)


def _list(value: Any, where: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ConfigError(f"{where} must be a list")
    return value


def _str(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{where} must be a non-empty string")
    return value.strip()


def _mapping(value: Any, where: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError(f"{where} must be a mapping")
    return value


def _date(value: Any, where: str) -> str:
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return dt.date.fromisoformat(value.strip()).isoformat()
        except ValueError:
            pass
    raise ConfigError(f"{where} must be a date (YYYY-MM-DD)")


def _year(value: Any, where: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1880 <= value <= 2100:
        raise ConfigError(f"{where} must be a year between 1880 and 2100 (or null)")
    return value


def _bool(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        raise ConfigError(f"{where} must be true or false")
    return value


def _score(value: Any, where: str) -> Decimal | None:
    """A score override: a number (or numeric string), or null to remove.

    Parsed exactly like a sheet cell (half-up rounding to hundredths); the
    0-10 range is checked in ``interpret`` (easter-egg films may exceed it).
    """
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ConfigError(f"{where} must be a number or null")
    parsed = parse_score(str(value))
    if parsed is None or parsed.error or parsed.value is None:
        raise ConfigError(f"{where} must be a number or null, not {value!r}")
    return parsed.value


def _colour(value: Any, where: str) -> str:
    colour = normalise_colour(_str(value, where))
    if not colour or len(colour) != 7:
        raise ConfigError(f"{where} must be a #rrggbb colour")
    return colour


def from_dict(data: dict[str, Any] | None, sheet_people: list[dict[str, Any]] | None = None) -> Config:
    """Build a :class:`Config` from parsed YAML.

    ``sheet_people`` (the person columns of ``sheet.json``) fills in colours
    for roster entries that have a column. A column the roster doesn't
    mention still gets an entry (keyword = column name, ``in_roster=False``)
    so its data isn't lost; ``interpret`` lists it under needs-decision.
    """
    data = data or {}
    if not isinstance(data, dict):
        raise ConfigError("the overrides file must be a mapping")
    known = {"people", "system_profiles", "rules", "films", "expected", "expected_notes", "today", "tmdb"}
    unknown = set(data) - known
    if unknown:
        raise ConfigError(f"unknown top-level keys: {sorted(unknown)}")

    cfg = Config()
    columns = {c["name"]: c for c in (sheet_people or [])}
    for i, raw in enumerate(_list(data.get("people"), "people")):
        where = f"people[{i}]"
        if not isinstance(raw, dict):
            raise ConfigError(f"{where} must be a mapping")
        name = _str(raw.get("name"), f"{where}.name")
        keywords = [_str(k, f"{where}.keywords") for k in _list(raw.get("keywords"), f"{where}.keywords")]
        column = raw.get("column", name if name in columns else None)
        colour = raw.get("colour")
        if colour is None and column in columns:
            colour = columns[column]["colour"]
        role = raw.get("role", "member")
        if role not in ("admin", "moderator", "member", "viewer"):
            raise ConfigError(f"{where}.role must be admin, moderator, member or viewer")
        cfg.people.append(
            Person(
                name=name,
                keywords=keywords or [name],
                colour=_colour(colour, f"{where}.colour") if colour else None,
                column=column,
                role=role,
                alt_colours=[_colour(c, f"{where}.alt_colours") for c in _list(raw.get("alt_colours"), where)],
            )
        )
    names = [p.name for p in cfg.people]
    if len(names) != len(set(names)):
        raise ConfigError("people: duplicate names")
    used_columns = {p.column for p in cfg.people}
    for name, col in columns.items():
        if name not in used_columns:
            cfg.people.append(
                Person(name=name, keywords=[name], colour=col["colour"], column=name, in_roster=False)
            )

    systems = _mapping(data.get("system_profiles"), "system_profiles")
    for key, attr in (("cinema", "cinema_profile"), ("archive", "archive_profile")):
        if key in systems:
            raw = _mapping(systems[key], f"system_profiles.{key}")
            getattr(cfg, attr).update(
                {
                    "name": _str(raw.get("name", getattr(cfg, attr)["name"]), f"system_profiles.{key}.name"),
                    "colour": _colour(raw.get("colour", getattr(cfg, attr)["colour"]), f"system_profiles.{key}.colour"),
                }
            )

    rules = _mapping(data.get("rules"), "rules")
    cfg.cinema_colours = [_colour(c, "rules.cinema_colours") for c in _list(rules.get("cinema_colours"), "rules.cinema_colours")]
    if rules.get("maratona_default") is not None:
        cfg.maratona_default = _str(rules["maratona_default"], "rules.maratona_default")
    for i, raw in enumerate(_list(rules.get("tag_colour_fixes"), "rules.tag_colour_fixes")):
        where = f"rules.tag_colour_fixes[{i}]"
        raw = _mapping(raw, where)
        cfg.tag_colour_fixes.append(
            TagColourFix(
                tag=_str(raw.get("tag"), f"{where}.tag"),
                colour=_colour(raw.get("colour"), f"{where}.colour"),
                person=_str(raw.get("person"), f"{where}.person"),
                reason=str(raw.get("reason", "")),
            )
        )
    cfg.ignore_tags = [str(t) for t in _list(rules.get("ignore_tags"), "rules.ignore_tags")]

    for i, raw in enumerate(_list(data.get("films"), "films")):
        where = f"films[{i}]"
        if not isinstance(raw, dict) or not isinstance(raw.get("match"), dict) or not raw["match"]:
            raise ConfigError(f"{where} needs a non-empty 'match' mapping")
        bad_match = set(raw["match"]) - {"row", "date", "title"}
        if bad_match:
            raise ConfigError(f"{where}.match: unknown keys {sorted(bad_match)}")
        match: dict[str, Any] = {}
        for key, value in raw["match"].items():
            if key == "row":
                if isinstance(value, bool) or not isinstance(value, int):
                    raise ConfigError(f"{where}.match.row must be a whole number")
                match[key] = value
            elif key == "date":
                match[key] = _date(value, f"{where}.match.date")
            else:
                match[key] = _str(value, f"{where}.match.title")
        sets = dict(_mapping(raw.get("set"), f"{where}.set"))
        bad = set(sets) - FILM_SET_FIELDS
        if bad:
            raise ConfigError(f"{where}.set: unknown keys {sorted(bad)}")
        if "kind" in sets and sets["kind"] not in KINDS:
            raise ConfigError(f"{where}.set.kind must be one of {KINDS}")
        if "title" in sets:
            sets["title"] = _str(sets["title"], f"{where}.set.title")
        if "year" in sets:
            sets["year"] = _year(sets["year"], f"{where}.set.year")
        if "date" in sets:
            sets["date"] = _date(sets["date"], f"{where}.set.date")
        for key in ("assigned", "turn_holder"):
            if sets.get(key) is not None:
                sets[key] = _str(sets[key], f"{where}.set.{key}")
        for key in ("exclude", "easter_egg"):
            if key in sets:
                sets[key] = _bool(sets[key], f"{where}.set.{key}")
        if "present" in sets:
            sets["present"] = {
                _str(k, f"{where}.set.present"): _bool(v, f"{where}.set.present.{k}")
                for k, v in _mapping(sets["present"], f"{where}.set.present").items()
            }
        if "scores" in sets:
            sets["scores"] = {
                _str(k, f"{where}.set.scores"): _score(v, f"{where}.set.scores.{k}")
                for k, v in _mapping(sets["scores"], f"{where}.set.scores").items()
            }
        cfg.films.append(FilmOverride(match=match, set=sets, reason=str(raw.get("reason", ""))))

    known_people = {p.name for p in cfg.people} | {cfg.cinema_profile["name"]}
    references = [(f.person, "rules.tag_colour_fixes") for f in cfg.tag_colour_fixes]
    if cfg.maratona_default:
        references.append((cfg.maratona_default, "rules.maratona_default"))
    for f in cfg.films:
        for key in ("assigned", "turn_holder"):
            if f.set.get(key):
                references.append((f.set[key], f"films {f.match} set.{key}"))
    for name, where in references:
        if name not in known_people:
            raise ConfigError(f"{where}: unknown person {name!r}")

    for key, value in _mapping(data.get("expected"), "expected").items():
        if isinstance(value, bool) or not isinstance(value, int):
            raise ConfigError(f"expected.{key} must be a whole number")
        cfg.expected[str(key)] = value
    cfg.expected_notes = {str(k): str(v) for k, v in _mapping(data.get("expected_notes"), "expected_notes").items()}
    for key, raw in _mapping(data.get("tmdb"), "tmdb").items():
        where = f"tmdb[{key!r}]"
        raw = _mapping(raw, where)
        if set(raw) - {"tmdb_id", "no_tmdb", "year", "reason"}:
            raise ConfigError(f"{where}: unknown keys {sorted(set(raw) - {'tmdb_id', 'no_tmdb', 'year', 'reason'})}")
        tmdb_id = raw.get("tmdb_id")
        if raw.get("no_tmdb") is True and tmdb_id is None and _year(raw.get("year"), f"{where}.year"):
            cfg.tmdb[str(key)] = {"no_tmdb": True, "year": raw["year"]}
        elif "no_tmdb" not in raw and "year" not in raw and isinstance(tmdb_id, int) and not isinstance(tmdb_id, bool) and tmdb_id > 0:
            cfg.tmdb[str(key)] = {"tmdb_id": tmdb_id}
        else:
            raise ConfigError(f"{where} needs either tmdb_id (a positive number) or no_tmdb: true with a year")
    if data.get("today") is not None:
        cfg.today = dt.date.fromisoformat(_date(data["today"], "today"))
    return cfg


def load(path: str | None, sheet_people: list[dict[str, Any]] | None = None) -> Config:
    """Load the overrides YAML at ``path`` (``None`` = no overrides)."""
    if not path:
        return from_dict({}, sheet_people)
    try:
        import yaml  # PyYAML; see migration/requirements.txt
    except ImportError as exc:  # pragma: no cover - environment problem
        raise ConfigError("PyYAML is required to read the overrides file (pip install -r migration/requirements.txt)") from exc
    try:
        with open(path, encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f" (line {mark.line + 1}, column {mark.column + 1})" if mark else ""
        raise ConfigError(f"{path}: not valid YAML{where}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError(f"{path}: can't read the overrides file ({exc})") from exc
    return from_dict(data, sheet_people)
