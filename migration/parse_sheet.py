"""Step 1: Google Sheets HTML export -> ``sheet.json``.

The export is one ``<table class="waffle">``. Cell background colours are CSS
classes (``<td class="s12">``) defined in the inline ``<style>`` as
``.ritz .waffle .s12{background-color:#xxxxxx;...}``. This module only reads the
file as text with :mod:`html.parser`; it never executes or renders anything.

The output is a faithful, uninterpreted copy of the sheet: one record per data
row with the date text, raw title, title link, title cell colour, notes and, for
each person column, the raw text, the cell colour and whether it is coloured.
"""

from __future__ import annotations

import hashlib
import re
from html.parser import HTMLParser
from typing import Any

# Background colours that mean "no colour": Google's alternating banding.
BANDING_COLOURS = frozenset({"#ffffff", "#f3f3f3"})

# Header labels of the non-person columns (column A, the date, has no label).
TITLE_HEADER = "Filme"
AVERAGE_HEADER = "Média"
NOTES_HEADER = "Notas"

_CSS_RULE = re.compile(r"\.waffle\s+\.(s\d+)\s*\{([^}]*)\}")
_CSS_BG = re.compile(r"background-color\s*:\s*(#[0-9a-fA-F]{3,8})")
_CLASS_TOKEN = re.compile(r"^s\d+$")


class SheetFormatError(ValueError):
    """The HTML does not look like the expected sheet export."""


def normalise_colour(value: str | None) -> str | None:
    """Lower-case ``#rrggbb``; expands ``#rgb``. ``None`` stays ``None``."""
    if not value:
        return None
    value = value.strip().lower()
    if re.fullmatch(r"#[0-9a-f]{3}", value):
        value = "#" + "".join(ch * 2 for ch in value[1:])
    return value


def is_coloured(colour: str | None) -> bool:
    """True when a cell has a real fill (not empty and not the banding)."""
    return colour is not None and colour not in BANDING_COLOURS


def css_colour_map(html_text: str) -> dict[str, str]:
    """Map each ``sNN`` class to its background colour."""
    colours: dict[str, str] = {}
    for match in _CSS_RULE.finditer(html_text):
        bg = _CSS_BG.search(match.group(2))
        if bg:
            colours[match.group(1)] = normalise_colour(bg.group(1))  # type: ignore[assignment]
    return colours


class _TableReader(HTMLParser):
    """Collects the rows of the first ``waffle`` table as raw cells."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[dict[str, Any]] = []
        self._depth = 0  # nesting depth inside the waffle table
        self._in_tbody = False
        self._row: dict[str, Any] | None = None
        self._cell: dict[str, Any] | None = None
        self._th: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        if tag == "table":
            if self._depth or "waffle" in a.get("class", "").split():
                self._depth += 1
            return
        if not self._depth:
            return
        if tag == "tbody":
            self._in_tbody = True
        elif not self._in_tbody:
            return
        elif tag == "tr":
            self._row = {"number": None, "freeze": False, "cells": []}
        elif tag == "th" and self._row is not None:
            self._th = {"text": ""}
            if "freezebar-cell" in a.get("class", ""):
                self._row["freeze"] = True
        elif tag == "td" and self._row is not None:
            classes = a.get("class", "").split()
            if "freezebar-cell" in classes:
                self._row["freeze"] = True
            self._cell = {
                "class": next((c for c in classes if _CLASS_TOKEN.match(c)), None),
                "text": "",
                "link": None,
                "span": "rowspan" in a or "colspan" in a,
            }
        elif tag == "a" and self._cell is not None and self._cell["link"] is None:
            self._cell["link"] = a.get("href") or None
        elif tag == "br" and self._cell is not None:
            self._cell["text"] += "\n"

    def handle_endtag(self, tag: str) -> None:
        if not self._depth:
            return
        if tag == "table":
            self._depth -= 1
            if not self._depth:
                self._in_tbody = False
        elif tag == "td" and self._cell is not None and self._row is not None:
            self._row["cells"].append(self._cell)
            self._cell = None
        elif tag == "th" and self._th is not None and self._row is not None:
            text = self._th["text"].strip()
            self._row["number"] = int(text) if text.isdigit() else None
            self._th = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell["text"] += data
        elif self._th is not None:
            self._th["text"] += data


def _cell_record(cell: dict[str, Any], colours: dict[str, str]) -> dict[str, Any]:
    colour = colours.get(cell["class"] or "")
    return {"text": cell["text"], "colour": colour, "coloured": is_coloured(colour)}


def parse_html(html_text: str, source_name: str = "sheet.html") -> dict[str, Any]:
    """Parse the export text into the ``sheet.json`` structure."""
    colours = css_colour_map(html_text)
    reader = _TableReader()
    reader.feed(html_text)
    reader.close()
    rows = [r for r in reader.rows if not r["freeze"]]
    if not rows:
        raise SheetFormatError("no rows found in a <table class=\"waffle\">")

    header_index = next(
        (i for i, r in enumerate(rows) if any(c["text"].strip() == TITLE_HEADER for c in r["cells"])),
        None,
    )
    if header_index is None:
        raise SheetFormatError(f"header row with a {TITLE_HEADER!r} column not found")
    header = [c["text"].strip() for c in rows[header_index]["cells"]]
    header_cells = rows[header_index]["cells"]

    def column(label: str, required: bool = True) -> int | None:
        if label in header:
            return header.index(label)
        if required:
            raise SheetFormatError(f"column {label!r} not found in the header")
        return None

    title_col = column(TITLE_HEADER)
    assert title_col is not None
    date_col = title_col - 1
    if date_col < 0:
        raise SheetFormatError("no date column before the title column")
    average_col = column(AVERAGE_HEADER, required=False)
    notes_col = column(NOTES_HEADER, required=False)
    end = average_col if average_col is not None else (notes_col or len(header))
    people = [
        {
            "name": header[i],
            "column": i,
            "colour": colours.get(header_cells[i]["class"] or ""),
        }
        for i in range(title_col + 1, end)
        if header[i]
    ]

    def text_at(cells: list[dict[str, Any]], i: int | None) -> str:
        return cells[i]["text"] if i is not None and i < len(cells) else ""

    data_rows: list[dict[str, Any]] = []
    ignored_rows: list[dict[str, Any]] = []
    spans = 0
    for position, row in enumerate(rows[header_index + 1 :]):
        cells = row["cells"]
        spans += sum(1 for c in cells if c["span"])
        date_text = text_at(cells, date_col).strip()
        title_text = text_at(cells, title_col)
        if not date_text and not title_text.strip():
            stray = [i for i, c in enumerate(cells) if c["text"].strip()]
            if stray:
                ignored_rows.append({"sheet_row": row["number"], "columns_with_text": stray})
            continue
        title_cell = cells[title_col] if title_col < len(cells) else {"class": None, "link": None}
        record: dict[str, Any] = {
            "sheet_row": row["number"] if row["number"] is not None else header_index + 2 + position,
            "date": date_text,
            "title_raw": title_text,
            "title_colour": colours.get(title_cell["class"] or ""),
            "link": title_cell.get("link"),
            "people": {},
            "average_raw": text_at(cells, average_col).strip(),
            "notes": text_at(cells, notes_col).strip(),
        }
        for person in people:
            i = person["column"]
            cell = cells[i] if i < len(cells) else {"class": None, "text": ""}
            record["people"][person["name"]] = _cell_record(cell, colours)
        data_rows.append(record)

    return {
        "format": "film-club-sheet/1",
        "source": {
            "name": source_name,
            "sha256": hashlib.sha256(html_text.encode("utf-8")).hexdigest(),
        },
        "columns": {
            "date": date_col,
            "title": title_col,
            "people": people,
            "average": average_col,
            "notes": notes_col,
        },
        "merged_cells": spans,
        "rows": data_rows,
        "ignored_rows": ignored_rows,
    }


def parse_file(path: str) -> dict[str, Any]:
    """Read the export at ``path`` (as text, UTF-8) and parse it."""
    import os

    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    return parse_html(text, source_name=os.path.basename(path))
