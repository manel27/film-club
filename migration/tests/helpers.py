"""Shared helpers: everything here uses the synthetic fixture only."""

from __future__ import annotations

import copy
import datetime as dt
import os
from functools import lru_cache
from typing import Any

from migration import config as config_mod
from migration.interpret import interpret
from migration.parse_sheet import parse_file

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixtures", "sheet.html")
EXAMPLE_OVERRIDES = os.path.join(os.path.dirname(HERE), "overrides.example.yaml")
TODAY = dt.date(2026, 12, 1)


@lru_cache(maxsize=1)
def _sheet() -> dict[str, Any]:
    return parse_file(FIXTURE)


def sheet() -> dict[str, Any]:
    """A fresh (mutable) copy of the parsed fixture."""
    return copy.deepcopy(_sheet())


@lru_cache(maxsize=1)
def _raw_overrides() -> dict[str, Any]:
    import yaml

    with open(EXAMPLE_OVERRIDES, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def overrides() -> dict[str, Any]:
    """A fresh copy of the example overrides as a dict."""
    return copy.deepcopy(_raw_overrides())


def run(sheet_data: dict[str, Any] | None = None, raw: dict[str, Any] | None = None) -> dict[str, Any]:
    data = sheet_data if sheet_data is not None else sheet()
    cfg = config_mod.from_dict(raw if raw is not None else overrides(), data["columns"]["people"])
    return interpret(data, cfg, today=TODAY)


def film(result: dict[str, Any], row: int) -> dict[str, Any]:
    return next(f for f in result["films"] if f["legacy_sheet_row"] == row)


def row(sheet_data: dict[str, Any], number: int) -> dict[str, Any]:
    return next(r for r in sheet_data["rows"] if r["sheet_row"] == number)


def rules(entries: list[dict[str, Any]], number: int | None = None) -> list[str]:
    return [e["rule"] for e in entries if number is None or e.get("row") == number]


def key(result: dict[str, Any], number: int) -> str:
    """The legacy_key of the film from sheet row ``number``."""
    return film(result, number)["legacy_key"]


def scores_of(result: dict[str, Any], number: int) -> dict[str, str]:
    k = key(result, number)
    return {s["profile"]: s["score"] for s in result["scores"] if s["film"] == k}


def present_at(result: dict[str, Any], number: int) -> set[str]:
    k = key(result, number)
    return {a["profile"] for a in result["attendance"] if a["film"] == k}
