"""Command line: ``parse``, ``interpret``, ``preview`` or ``all``.

Run it in isolated mode so nothing next to the sheet can be imported::

    python3 -I migration/run.py all --sheet <export.html> --out migration/out \
        --overrides migration/overrides.yaml

(``python3 -m migration.cli ...`` from the repo root works too, without ``-I``.)

Exit codes: 0 ok, 1 bad input or config, 3 duplicate films found.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from typing import Any

from . import config as config_mod
from .dupes import DuplicateFilmError
from .interpret import interpret
from .parse_sheet import SheetFormatError, parse_file
from .preview import render_html, render_markdown


def _write_json(path: str, data: Any) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def _read_json(path: str) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _write_text(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="migration", description="Film Club sheet migration (parse -> interpret -> preview)")
    parser.add_argument("step", choices=["parse", "interpret", "preview", "all"])
    parser.add_argument("--sheet", help="the sheet's HTML export (parse, all)")
    parser.add_argument("--out", required=True, help="output directory (git-ignored migration/out)")
    parser.add_argument("--overrides", help="overrides YAML (roster, rules and corrections)")
    parser.add_argument("--today", help="YYYY-MM-DD; films after it are 'planned' (default: today)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    sheet_path = os.path.join(args.out, "sheet.json")
    import_path = os.path.join(args.out, "import.json")
    today = dt.date.fromisoformat(args.today) if args.today else None

    try:
        if args.step in ("parse", "all"):
            if not args.sheet:
                print("error: --sheet is required for parse/all", file=sys.stderr)
                return 1
            sheet = parse_file(args.sheet)
            _write_json(sheet_path, sheet)
            print(f"parse: {len(sheet['rows'])} rows -> {sheet_path}")
        if args.step in ("interpret", "all"):
            sheet = _read_json(sheet_path)
            cfg = config_mod.load(args.overrides, sheet["columns"]["people"])
            data = interpret(sheet, cfg, today=today)
            _write_json(import_path, data)
            c = data["counts"]
            print(
                f"interpret: {c['films']} films, {c['scores']} scores, {c['attendance']} present, "
                f"{c['comments']} comments, {c['fixes']} fixes, {c['needs_decision']} need a decision -> {import_path}"
            )
        if args.step in ("preview", "all"):
            data = _read_json(import_path)
            _write_text(os.path.join(args.out, "preview.html"), render_html(data))
            _write_text(os.path.join(args.out, "preview.md"), render_markdown(data))
            print(f"preview: {os.path.join(args.out, 'preview.html')} and preview.md")
    except DuplicateFilmError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3
    except (SheetFormatError, config_mod.ConfigError, FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
