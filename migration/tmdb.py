"""TMDB matching (phase 4c).

``interpret`` stores ``tmdb_query`` on every film. :func:`match_all` runs the
searches (``/3/search/movie``), picks a match, fetches its details
(``/3/movie/{id}?append_to_response=credits``) and gives it a confidence:

- **high**: the normalised title (or original title) equals the query and the
  release year equals the sheet's year hint; with no year hint, the exact-title
  match must also be the clear favourite (10x the votes of any other film with
  that exact title). A ``tmdb_id`` pinned in the overrides file is high too.
- **medium**: exact title one year off the hint, a different title with the
  hinted year, or an exact title that isn't the clear favourite.
- **low**: neither title nor year agree; TMDB's first result is kept.
- **none**: no result (or ``no_tmdb`` in the overrides file).

Every response is cached in ``<out>/tmdb_cache/`` (git-ignored), so re-runs
don't touch the network and give the same result.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from .text import title_norm

API = "https://api.themoviedb.org/3"
IMAGE_BASE = "https://image.tmdb.org/t/p/"
CONFIDENCE_LEVELS = ("high", "medium", "low", "none")
MIN_INTERVAL = 0.06  # seconds between network requests (under 20 per second)
RETRIES = 5


def build_query(title: str, year_hint: int | None, link: Any | None) -> dict[str, Any]:
    """TMDB ``/3/search/movie`` parameters for one film, plus fallback titles
    taken from the sheet's link (e.g. a Wikipedia page title)."""
    alternatives: list[str] = []
    if link is not None and link.is_film_page and link.title and link.title != title:
        alternatives.append(link.title)
    return {"query": title, "year": year_hint, "language": "en-US", "alternative_queries": alternatives}


class TmdbError(RuntimeError):
    """A TMDB request failed (the message never includes request headers)."""


def read_token(env_path: str) -> str:
    """``TMDB_TOKEN`` from a git-ignored env file. Never printed."""
    try:
        with open(env_path, encoding="utf-8") as fh:
            for line in fh:
                name, _, value = line.strip().partition("=")
                if name.strip() == "TMDB_TOKEN" and value.strip():
                    return value.strip().strip("'\"")
    except OSError as exc:
        raise TmdbError(f"can't read {env_path} ({exc.strerror})") from None
    raise TmdbError(f"{env_path} has no TMDB_TOKEN line")


class Client:
    """Cached, rate-limited GET client. ``token`` is a callable so the env file
    is only read when something is not cached yet."""

    def __init__(
        self,
        cache_dir: str,
        token: Callable[[], str] | None,
        urlopen: Callable[..., Any] = urllib.request.urlopen,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.cache_dir = cache_dir
        self.token = token
        self.urlopen = urlopen
        self.sleep = sleep
        self.network_requests = 0
        self.fetched_at: str | None = None  # when the last response was first fetched
        self._last = 0.0

    def get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        query = urllib.parse.urlencode(sorted((k, v) for k, v in params.items() if v is not None))
        url = f"{API}/{path}?{query}"
        cache_file = os.path.join(self.cache_dir, hashlib.sha256(url.encode()).hexdigest()[:40] + ".json")
        if os.path.exists(cache_file):
            with open(cache_file, encoding="utf-8") as fh:
                cached = json.load(fh)
            self.fetched_at = cached["fetched_at"]
            return cached["body"]
        if self.token is None:
            raise TmdbError(f"not cached and no token: {path}")
        body = self._fetch(url, path)
        os.makedirs(self.cache_dir, exist_ok=True)
        fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        tmp = cache_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"url": url, "fetched_at": fetched_at, "body": body}, fh, ensure_ascii=False)
        os.replace(tmp, cache_file)
        self.fetched_at = fetched_at
        return body

    def _fetch(self, url: str, path: str) -> dict[str, Any]:
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token()}", "Accept": "application/json"})
        for attempt in range(RETRIES + 1):
            wait = MIN_INTERVAL - (time.monotonic() - self._last)
            if wait > 0:
                self.sleep(wait)
            self._last = time.monotonic()
            self.network_requests += 1
            try:
                with self.urlopen(request, timeout=30) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if (exc.code == 429 or exc.code >= 500) and attempt < RETRIES:
                    retry_after = exc.headers.get("Retry-After") if exc.headers else None
                    self.sleep(float(retry_after) if retry_after and retry_after.isdigit() else 2**attempt)
                    continue
                raise TmdbError(f"TMDB {path}: HTTP {exc.code}") from None
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                if attempt < RETRIES:
                    self.sleep(2**attempt)
                    continue
                raise TmdbError(f"TMDB {path}: {type(exc).__name__}") from None
        raise AssertionError("unreachable")


def _year(result: dict[str, Any]) -> int | None:
    date = result.get("release_date") or ""
    return int(date[:4]) if len(date) >= 4 and date[:4].isdigit() else None


def score_candidates(
    candidates: list[dict[str, Any]], queries: list[str], year_hint: int | None
) -> tuple[dict[str, Any] | None, str, str]:
    """Pick a search result and rate it. ``candidates`` are in TMDB's order.
    Returns ``(chosen, confidence, reason)``."""
    if not candidates:
        return None, "none", "no TMDB result"
    wanted = {title_norm(q) for q in queries}
    exact = [c for c in candidates if {title_norm(c.get("title") or ""), title_norm(c.get("original_title") or "")} & wanted]
    if year_hint:
        for pool, confidence, reason in (
            ([c for c in exact if _year(c) == year_hint], "high", "exact title and year"),
            ([c for c in exact if _year(c) and abs(_year(c) - year_hint) == 1], "medium", "exact title, year off by one"),
            ([c for c in candidates if _year(c) == year_hint], "medium", "same year, different title"),
            (exact, "low", "exact title, different year"),
        ):
            if pool:
                return max(pool, key=lambda c: c.get("vote_count") or 0), confidence, reason
        return candidates[0], "low", "neither title nor year match"
    if exact:
        exact.sort(key=lambda c: -(c.get("vote_count") or 0))
        top = exact[0].get("vote_count") or 0
        if top > 0 and all((c.get("vote_count") or 0) * 10 <= top for c in exact[1:]):
            return exact[0], "high", "exact title, clear favourite (no year hint)"
        return exact[0], "medium", f"exact title, {len(exact)} films share it (no year hint)"
    return candidates[0], "low", "no exact title (no year hint)"


def details_to_match(d: dict[str, Any]) -> dict[str, Any]:
    """The film columns (plan §2.2) from a ``movie/{id}?append_to_response=credits`` response."""
    crew = (d.get("credits") or {}).get("crew") or []
    directors = list(dict.fromkeys(c["name"] for c in crew if c.get("job") == "Director" and c.get("name")))
    return {
        "tmdb_id": d["id"],
        "title": d.get("title") or d.get("original_title"),
        "original_title": d.get("original_title") or None,
        "release_date": d.get("release_date") or None,
        "release_year": _year(d),
        "poster_path": d.get("poster_path"),
        "backdrop_path": d.get("backdrop_path"),
        "overview": d.get("overview") or None,
        "runtime_min": d.get("runtime") or None,
        "genres": [g["name"] for g in d.get("genres") or []],
        "directors": directors,
    }


def match_film(film: dict[str, Any], client: Client, pin: dict[str, Any] | None = None) -> dict[str, Any]:
    """Match one ``import.json`` film. ``pin`` is its entry from the overrides
    file's ``tmdb:`` section, if any."""
    q = film["tmdb_query"]
    if pin and pin.get("no_tmdb"):
        return {"tmdb_id": None, "release_year": pin["year"], "confidence": "none", "pinned": True, "reason": "no_tmdb in the overrides file"}
    if pin:
        tmdb_id, confidence, reason = pin["tmdb_id"], "high", "tmdb_id pinned in the overrides file"
    else:
        queries = [q["query"], *q.get("alternative_queries", [])]
        seen: dict[int, dict[str, Any]] = {}
        screened_year = int(film["screened_on"][:4])
        for text in queries:
            years = [q["year"], None] if q.get("year") else [None]
            for year in years:
                params = {"query": text, "year": year, "language": q.get("language", "en-US"), "include_adult": "false"}
                results = client.get("search/movie", params).get("results") or []
                for r in results:
                    # Released after the screening year: can't be the film the club watched.
                    if film.get("is_planned") or (_year(r) or 9999) <= screened_year:
                        seen.setdefault(r["id"], r)
                if results:
                    break
        chosen, confidence, reason = score_candidates(list(seen.values()), queries, q.get("year"))
        if chosen is None:
            return {"tmdb_id": None, "release_year": q.get("year"), "confidence": "none", "pinned": False, "reason": reason}
        tmdb_id = chosen["id"]
    details = client.get(f"movie/{tmdb_id}", {"append_to_response": "credits", "language": q.get("language", "en-US")})
    return {
        **details_to_match(details),
        "fetched_at": client.fetched_at,
        "confidence": confidence,
        "pinned": bool(pin),
        "reason": reason,
    }


def match_all(data: dict[str, Any], client: Client, pins: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """``matches.json``: one match per film ``legacy_key``, plus counts."""
    keys = {f["legacy_key"] for f in data["films"]}
    unknown = sorted(set(pins) - keys)
    if unknown:
        raise ValueError(f"overrides tmdb: no film with legacy_key {unknown}")
    matches = {f["legacy_key"]: match_film(f, client, pins.get(f["legacy_key"])) for f in data["films"]}
    find_duplicate_matches(data["films"], matches, raise_error=True)
    counts = {level: sum(1 for m in matches.values() if m["confidence"] == level) for level in CONFIDENCE_LEVELS}
    counts["pinned"] = sum(1 for m in matches.values() if m["pinned"])
    counts["to_check"] = len(to_check(matches))
    return {"format": "film-club-matches/1", "counts": counts, "matches": matches}


def to_check(matches: dict[str, dict[str, Any]]) -> list[str]:
    """Legacy keys of matches the owner should confirm (medium/low/none, not pinned)."""
    order = {level: i for i, level in enumerate(CONFIDENCE_LEVELS)}
    keys = [k for k, m in matches.items() if m["confidence"] != "high" and not m["pinned"]]
    return sorted(keys, key=lambda k: (-order[matches[k]["confidence"]], k))


def find_duplicate_matches(
    films: list[dict[str, Any]], matches: dict[str, dict[str, Any]], raise_error: bool = False
) -> list[list[dict[str, Any]]]:
    """The DB's no-duplicate rule (plan §4.3) on the matched films: the same
    ``tmdb_id`` twice, or a film without TMDB that has the same normalised
    title and year as another film."""
    from .dupes import DuplicateFilmError

    groups: list[list[dict[str, Any]]] = []
    by_id: dict[int, list[dict[str, Any]]] = {}
    by_title: dict[tuple[str, int | None], list[dict[str, Any]]] = {}
    for f in films:
        m = matches.get(f["legacy_key"]) or {}
        if m.get("tmdb_id"):
            by_id.setdefault(m["tmdb_id"], []).append(f)
        titles = {f["title_norm"]} if not m.get("tmdb_id") else {title_norm(m.get("title") or ""), title_norm(m.get("original_title") or "")}
        for t in titles - {""}:
            by_title.setdefault((t, m.get("release_year")), []).append((f, bool(m.get("tmdb_id"))))
    groups += [g for g in by_id.values() if len(g) > 1]
    for entries in by_title.values():
        if len(entries) > 1 and not all(has_id for _, has_id in entries):
            group = list({id(f): f for f, _ in entries}.values())
            if len(group) > 1 and group not in groups:
                groups.append(group)
    if groups and raise_error:
        raise DuplicateFilmError(groups)
    return groups
