"""Small text helpers: title normalisation, bracket tags, links and scores."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from urllib.parse import unquote, urlsplit

_TRAILING_TAG = re.compile(r"\s*\(([^()]*)\)\s*$")
_YEAR = re.compile(r"(?<!\d)(18[89]\d|19\d\d|20\d\d)(?!\d)")
CENT = Decimal("0.01")


def fold(text: str) -> str:
    """Lower case without accents (for comparisons, not for display)."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()


def title_norm(title: str) -> str:
    """Mirror of the DB ``title_norm``: lower, no accents, no punctuation,
    collapsed whitespace."""
    folded = fold(title)
    return " ".join(re.sub(r"[^\w\s]|_", " ", folded).split())


def clean_spaces(text: str) -> str:
    """Collapse runs of whitespace (including line breaks) and trim."""
    return " ".join(text.split())


def split_tags(raw_title: str) -> tuple[str, list[str]]:
    """Split ``"Title (A) (B)"`` into ``("Title", ["A", "B"])``.

    Only trailing bracket groups are tags; brackets inside the title stay.
    """
    title = clean_spaces(raw_title)
    tags: list[str] = []
    while True:
        match = _TRAILING_TAG.search(title)
        if not match or match.start() == 0:
            break
        tags.insert(0, clean_spaces(match.group(1)))
        title = title[: match.start()].rstrip()
    return title, tags


def year_tag(tag: str) -> int | None:
    """``"1968"`` -> 1968; anything else -> None."""
    return int(tag) if re.fullmatch(r"(18[89]\d|19\d\d|20\d\d)", tag) else None


@dataclass
class LinkInfo:
    url: str
    site: str  # "wikipedia", "letterboxd" or the host name
    title: str | None  # page title without the disambiguator
    disambiguator: str | None  # e.g. "2007 film", "filme de 2006", "novel"
    year: int | None  # only when the disambiguator names a film year

    @property
    def is_film_page(self) -> bool:
        if self.site == "letterboxd":
            return True
        if self.disambiguator is None:
            return True  # plain article title; usually the film itself
        return "film" in fold(self.disambiguator)


def parse_link(url: str | None) -> LinkInfo | None:
    """Extract a title and year hint from a Wikipedia or Letterboxd URL."""
    if not url:
        return None
    parts = urlsplit(url)
    host = parts.hostname or ""
    segment = unquote(parts.path.rstrip("/").rsplit("/", 1)[-1])
    if host.endswith("wikipedia.org"):
        text = segment.replace("_", " ")
        match = _TRAILING_TAG.search(text)
        disamb = match.group(1).strip() if match and match.start() > 0 else None
        title = text[: match.start()].strip() if disamb else text.strip()
        year = None
        if disamb and "film" in fold(disamb):
            found = _YEAR.search(disamb)
            year = int(found.group(1)) if found else None
        return LinkInfo(url, "wikipedia", title or None, disamb, year)
    if host.endswith("letterboxd.com"):
        slug = segment
        year = None
        found = re.search(r"-(18[89]\d|19\d\d|20\d\d)$", slug)
        if found:
            year = int(found.group(1))
            slug = slug[: found.start()]
        return LinkInfo(url, "letterboxd", slug.replace("-", " ") or None, None, year)
    return LinkInfo(url, host, None, None, None)


@dataclass
class ParsedScore:
    value: Decimal | None  # rounded to hundredths
    raw: str
    comma: bool = False  # used a decimal comma
    rounded: bool = False  # had more than two decimals
    exact: Decimal | None = None  # value before rounding
    error: str | None = None


def parse_score(text: str) -> ParsedScore | None:
    """Parse a score cell. Empty -> None. Accepts ``7``, ``7.5``, ``7,25``.

    Values are rounded half-up to hundredths, like Postgres ``numeric(4,2)``.
    """
    raw = text
    text = text.strip()
    if not text:
        return None
    comma = "," in text
    candidate = text.replace(",", ".").replace(" ", "")
    if not re.fullmatch(r"[+-]?(\d+(\.\d*)?|\.\d+)", candidate):
        return ParsedScore(None, raw, comma, error="not a number")
    try:
        exact = Decimal(candidate)
    except InvalidOperation:  # pragma: no cover - guarded by the regex
        return ParsedScore(None, raw, comma, error="not a number")
    value = exact.quantize(CENT, rounding=ROUND_HALF_UP)
    return ParsedScore(value, raw, comma, rounded=value != exact, exact=exact)
