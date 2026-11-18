"""Command line: ``parse``, ``interpret``, ``preview`` or ``all``.

Run it in isolated mode so nothing next to the sheet can be imported::

    python3 -I migration/run.py all --sheet <export.html> --out <dir> \
        --overrides migration/overrides.yaml

Outputs are written to temporary files and moved into place only when a step
succeeds. When a step fails, its outputs and everything downstream of them
are deleted from ``--out``, so a failed run never leaves stale results.

Exit codes: 0 ok, 1 bad input, overrides file or output path, 3 duplicate
films found.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import tempfile
from typing import Any

from . import config as config_mod
from .dupes import DuplicateFilmError
from .interpret import interpret
from .parse_sheet import SheetFormatError, parse_file
from .preview import render_html, render_markdown

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
ALLOWED_OUT = os.path.join(REPO_ROOT, "migration", "out")

# Outputs of each step, including everything that depends on them.
STEP_OUTPUTS = {
    "parse": ["sheet.json", "import.json", "preview.html", "preview.md"],
    "interpret": ["import.json", "preview.html", "preview.md"],
    "preview": ["preview.html", "preview.md"],
}


class OutputPathError(ValueError):
    """``--out`` points somewhere inside the repository other than migration/out."""


def check_out_dir(path: str) -> str:
    """Refuse output directories inside the repo, except ``migration/out``
    (git-ignored). Anywhere outside the repo is fine."""
    real = os.path.realpath(path)
    inside_repo = os.path.commonpath([real, REPO_ROOT]) == REPO_ROOT
    inside_allowed = os.path.commonpath([real, ALLOWED_OUT]) == ALLOWED_OUT
    if inside_repo and not inside_allowed:
        raise OutputPathError(
            f"--out {path!r} is inside the repository; use migration/out (git-ignored) or a folder outside the repo"
        )
    return real


def _write_atomic(path: str, text: str) -> None:
    """Write to a temporary file in the same folder, then rename over ``path``."""
    folder = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=folder, prefix="." + os.path.basename(path) + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def _json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def _read_json(path: str) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _remove_outputs(out: str, step: str) -> None:
    for name in STEP_OUTPUTS[step]:
        path = os.path.join(out, name)
        if os.path.exists(path):
            os.unlink(path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="migration", description="Film Club sheet migration (parse -> interpret -> preview)")
    parser.add_argument("step", choices=["parse", "interpret", "preview", "all"])
    parser.add_argument("--sheet", help="the sheet's HTML export (parse, all)")
    parser.add_argument("--out", required=True, help="output directory (migration/out or outside the repo)")
    parser.add_argument("--overrides", help="overrides YAML (roster, rules and corrections)")
    parser.add_argument("--today", help="YYYY-MM-DD; films after it are 'planned' (overrides 'today:' in the overrides file)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    step = "parse" if args.step == "all" else args.step  # the step that is running
    try:
        out = check_out_dir(args.out)
        try:
            today = dt.date.fromisoformat(args.today) if args.today else None
        except ValueError:
            raise ValueError(f"--today must be a date (YYYY-MM-DD), not {args.today!r}") from None
        if args.step in ("parse", "all") and not args.sheet:
            raise ValueError("--sheet is required for parse/all")
        os.makedirs(out, exist_ok=True)
        sheet_path = os.path.join(out, "sheet.json")
        import_path = os.path.join(out, "import.json")

        if args.step in ("parse", "all"):
            step = "parse"
            sheet = parse_file(args.sheet)
            _write_atomic(sheet_path, _json(sheet))
            print(f"parse: {len(sheet['rows'])} rows -> {sheet_path}")
        if args.step in ("interpret", "all"):
            step = "interpret"
            sheet = _read_json(sheet_path)
            cfg = config_mod.load(args.overrides, sheet["columns"]["people"])
            data = interpret(sheet, cfg, today=today)
            _write_atomic(import_path, _json(data))
            c = data["counts"]
            print(
                f"interpret: {c['films']} films, {c['scores']} scores, {c['attendance']} present, "
                f"{c['comments']} comments, {c['fixes']} fixes, {c['needs_decision']} need a decision -> {import_path}"
            )
        if args.step in ("preview", "all"):
            step = "preview"
            data = _read_json(import_path)
            _write_atomic(os.path.join(out, "preview.html"), render_html(data))
            _write_atomic(os.path.join(out, "preview.md"), render_markdown(data))
            print(f"preview: {os.path.join(out, 'preview.html')} and preview.md")
    except OutputPathError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except DuplicateFilmError as exc:
        _remove_outputs(out, step)
        print(f"error: {exc}", file=sys.stderr)
        return 3
    except (SheetFormatError, config_mod.ConfigError, OSError, ValueError, KeyError) as exc:
        if "out" in locals() and os.path.isdir(out):
            _remove_outputs(out, step)
        message = f"missing key {exc}" if isinstance(exc, KeyError) else str(exc)
        print(f"error: {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
