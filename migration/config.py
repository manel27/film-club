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

from .parse_sheet import normalise_colour

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


def _colour(value: Any, where: str) -> str:
    colour = normalise_colour(_str(value, where))
    if not colour or len(colour) != 7:
        raise ConfigError(f"{where} must be a #rrggbb colour")
    return colour


def from_dict(data: dict[str, Any] | None, sheet_people: list[dict[str, Any]] | None = None) -> Config:
    """Build a :class:`Config` from parsed YAML.

    ``sheet_people`` (the person columns of ``sheet.json``) fills in colours
    for roster entries that have a column, and adds a bare entry (keyword =
    column name) for any column the roster does not mention.
    """
    data = data or {}
    if not isinstance(data, dict):
        raise ConfigError("the overrides file must be a mapping")
    known = {"people", "system_profiles", "rules", "films", "expected", "expected_notes", "today"}
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
            cfg.people.append(Person(name=name, keywords=[name], colour=col["colour"], column=name))

    systems = data.get("system_profiles") or {}
    for key, attr in (("cinema", "cinema_profile"), ("archive", "archive_profile")):
        if key in systems:
            raw = systems[key] or {}
            getattr(cfg, attr).update(
                {
                    "name": _str(raw.get("name", getattr(cfg, attr)["name"]), f"system_profiles.{key}.name"),
                    "colour": _colour(raw.get("colour", getattr(cfg, attr)["colour"]), f"system_profiles.{key}.colour"),
                }
            )

    rules = data.get("rules") or {}
    cfg.cinema_colours = [_colour(c, "rules.cinema_colours") for c in _list(rules.get("cinema_colours"), "rules.cinema_colours")]
    if rules.get("maratona_default") is not None:
        cfg.maratona_default = _str(rules["maratona_default"], "rules.maratona_default")
    for i, raw in enumerate(_list(rules.get("tag_colour_fixes"), "rules.tag_colour_fixes")):
        where = f"rules.tag_colour_fixes[{i}]"
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
        match = {k: (v.isoformat() if isinstance(v, dt.date) else v) for k, v in raw["match"].items()}
        sets = raw.get("set") or {}
        bad = set(sets) - FILM_SET_FIELDS
        if bad:
            raise ConfigError(f"{where}.set: unknown keys {sorted(bad)}")
        if "kind" in sets and sets["kind"] not in KINDS:
            raise ConfigError(f"{where}.set.kind must be one of {KINDS}")
        if "date" in sets and isinstance(sets["date"], dt.date):
            sets = {**sets, "date": sets["date"].isoformat()}
        cfg.films.append(FilmOverride(match=match, set=dict(sets), reason=str(raw.get("reason", ""))))

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

    cfg.expected = {str(k): int(v) for k, v in (data.get("expected") or {}).items()}
    cfg.expected_notes = {str(k): str(v) for k, v in (data.get("expected_notes") or {}).items()}
    if data.get("today"):
        today = data["today"]
        cfg.today = today if isinstance(today, dt.date) else dt.date.fromisoformat(str(today))
    return cfg


def load(path: str | None, sheet_people: list[dict[str, Any]] | None = None) -> Config:
    """Load the overrides YAML at ``path`` (``None`` = no overrides)."""
    if not path:
        return from_dict({}, sheet_people)
    try:
        import yaml  # PyYAML; see migration/requirements.txt
    except ImportError as exc:  # pragma: no cover - environment problem
        raise ConfigError("PyYAML is required to read the overrides file (pip install -r migration/requirements.txt)") from exc
    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    return from_dict(data, sheet_people)
