"""Duplicate-film check (plan §4.3): no film may appear twice, ever.

Before TMDB matching we only have a title and a year hint, so two films are
duplicates when their normalised titles are equal and their years are equal
or at least one year is unknown. Two rows that link to the same page are
duplicates too. Distinct known years (e.g. a 2000 film and its 2026 remake)
are allowed.
"""

from __future__ import annotations

from typing import Any


class DuplicateFilmError(ValueError):
    """Raised when the import would contain the same film twice."""

    def __init__(self, groups: list[list[dict[str, Any]]]):
        self.groups = groups
        lines = ["duplicate films found (fix them in the overrides file):"]
        for group in groups:
            lines.append(
                "  - "
                + " | ".join(
                    f"row {f['legacy_sheet_row']} {f['screened_on']} {f['title']!r}"
                    + (f" ({f['year_hint']})" if f.get("year_hint") else "")
                    for f in group
                )
            )
        super().__init__("\n".join(lines))


def find_duplicates(films: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Return groups of films that clash. Each film needs ``title_norm``,
    ``year_hint`` and ``source_url``."""
    groups: list[list[dict[str, Any]]] = []
    seen_pairs: set[tuple[int, int]] = set()
    by_title: dict[str, list[dict[str, Any]]] = {}
    for film in films:
        by_title.setdefault(film["title_norm"], []).append(film)
    for same_title in by_title.values():
        for i, a in enumerate(same_title):
            for b in same_title[i + 1 :]:
                ya, yb = a.get("year_hint"), b.get("year_hint")
                if ya is None or yb is None or ya == yb:
                    seen_pairs.add((id(a), id(b)))
                    groups.append([a, b])
    by_url: dict[str, list[dict[str, Any]]] = {}
    for film in films:
        if film.get("source_url"):
            by_url.setdefault(film["source_url"], []).append(film)
    for same_url in by_url.values():
        for i, a in enumerate(same_url):
            for b in same_url[i + 1 :]:
                if (id(a), id(b)) not in seen_pairs:
                    groups.append([a, b])
    return groups


def assert_no_duplicates(films: list[dict[str, Any]]) -> None:
    groups = find_duplicates(films)
    if groups:
        raise DuplicateFilmError(groups)
