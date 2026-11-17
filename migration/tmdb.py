"""Hook for TMDB matching (phase 4c; not implemented in phase 4a).

``interpret`` stores ``tmdb_query`` on every film (see :func:`build_query`) and
leaves ``tmdb`` as ``None``. The import phase plugs a matcher in with
:func:`apply_matches`; the matcher receives the query and returns either
``None`` (no match) or a dict such as::

    {"tmdb_id": 603, "title": "...", "original_title": "...",
     "release_year": 1999, "poster_path": "/...jpg", "confidence": "high"}

After matching, run :func:`migration.dupes.assert_no_duplicates` again keyed on
``tmdb_id`` as well: two rows must never resolve to the same TMDB film.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

Matcher = Callable[[dict[str, Any]], Optional[dict[str, Any]]]


def build_query(title: str, year_hint: int | None, link: Any | None) -> dict[str, Any]:
    """The search to run for one film: TMDB ``/3/search/movie`` parameters
    plus fallbacks taken from the sheet's link (e.g. a Wikipedia page title)."""
    alternatives: list[str] = []
    if link is not None and link.is_film_page and link.title and link.title != title:
        alternatives.append(link.title)
    return {
        "query": title,
        "year": year_hint,
        "language": "en-US",
        "alternative_queries": alternatives,
    }


def apply_matches(films: list[dict[str, Any]], matcher: Matcher | None) -> int:
    """Fill ``film["tmdb"]`` using ``matcher``. Returns how many matched."""
    if matcher is None:
        return 0
    matched = 0
    for film in films:
        result = matcher(film["tmdb_query"])
        film["tmdb"] = result
        matched += result is not None
    return matched
