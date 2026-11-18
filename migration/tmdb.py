"""Hook for TMDB matching (phase 4c; nothing calls TMDB in phase 4a).

``interpret`` stores ``tmdb_query`` on every film and leaves ``tmdb`` as
``None``. Phase 4c runs the search, fills ``tmdb`` and then re-runs the
duplicate check on ``tmdb_id``.
"""

from __future__ import annotations

from typing import Any


def build_query(title: str, year_hint: int | None, link: Any | None) -> dict[str, Any]:
    """TMDB ``/3/search/movie`` parameters for one film, plus fallback titles
    taken from the sheet's link (e.g. a Wikipedia page title)."""
    alternatives: list[str] = []
    if link is not None and link.is_film_page and link.title and link.title != title:
        alternatives.append(link.title)
    return {"query": title, "year": year_hint, "language": "en-US", "alternative_queries": alternatives}
