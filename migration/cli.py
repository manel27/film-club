"""Command line: ``parse``, ``interpret``, ``preview``, ``all``, ``tmdb`` or ``import``.

Run it in isolated mode so nothing next to the sheet can be imported::

    python3 -I migration/run.py all --sheet <export.html> --out <dir> \
        --overrides migration/overrides.yaml

Outputs are written to temporary files and moved into place only when a step
succeeds. When a step fails, its outputs and everything downstream of them
are deleted from ``--out``, so a failed run never leaves stale results.

``tmdb`` matches every film on TMDB (cached) and writes ``matches.json``;
``import`` writes the data into Supabase (see ``importer.py``).

Exit codes: 0 ok, 1 bad input, overrides file or output path (or the import
refused / failed), 3 duplicate films found, 4 the database counts don't match
the preview.
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
from . import importer, tmdb
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
    "tmdb": ["matches.json"],
    "import": [],
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
    parser.add_argument("step", choices=["parse", "interpret", "preview", "all", "tmdb", "import"])
    parser.add_argument("--sheet", help="the sheet's HTML export (parse, all)")
    parser.add_argument("--out", required=True, help="output directory (migration/out or outside the repo)")
    parser.add_argument("--overrides", help="overrides YAML (roster, rules and corrections)")
    parser.add_argument("--today", help="YYYY-MM-DD; films after it are 'planned' (overrides 'today:' in the overrides file)")
    parser.add_argument("--tmdb-env", default=os.path.join(REPO_ROOT, "migration", ".env"),
                        help="env file with TMDB_TOKEN (tmdb; only read when a response isn't cached)")
    parser.add_argument("--env", help="git-ignored env file with SUPABASE_URL and SUPABASE_SECRET_KEY (import)")
    parser.add_argument("--dry-run", action="store_true", help="import: print the planned counts, write nothing")
    parser.add_argument("--production", action="store_true", help="import: allow a non-local host (asks you to type it)")
    return parser


def _read_matches(out: str) -> dict[str, Any] | None:
    path = os.path.join(out, "matches.json")
    return _read_json(path) if os.path.exists(path) else None


def _import(args: argparse.Namespace, out: str) -> None:
    if not args.env:
        raise ValueError("--env is required for import")
    url, key, is_local = importer.read_env(args.env)
    prompt = input if sys.stdin.isatty() else None
    print(f"target: {url}{' (local stack)' if is_local else ''}")
    importer.check_target(url, is_local, args.production, prompt)
    data = _read_json(os.path.join(out, "import.json"))
    matches = _read_matches(out)
    if matches is None:
        raise importer.ImportRefused("no matches.json; run the tmdb step first")
    importer.run_import(data, matches["matches"], importer.Rest(url, key), dry_run=args.dry_run)


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
            matches = _read_matches(out)
            _write_atomic(os.path.join(out, "preview.html"), render_html(data, matches))
            _write_atomic(os.path.join(out, "preview.md"), render_markdown(data, matches))
            print(f"preview: {os.path.join(out, 'preview.html')} and preview.md")
        if args.step == "tmdb":
            data = _read_json(import_path)
            pins = config_mod.load(args.overrides).tmdb
            client = tmdb.Client(os.path.join(out, "tmdb_cache"), lambda: tmdb.read_token(args.tmdb_env))
            result = tmdb.match_all(data, client, pins)
            _write_atomic(os.path.join(out, "matches.json"), _json(result))
            print(f"tmdb: {result['counts']} ({client.network_requests} network requests) -> matches.json")
        if args.step == "import":
            _import(args, out)
    except importer.CountMismatch as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 4
    except (importer.ImportRefused, tmdb.TmdbError, RuntimeError) as exc:
        if args.step == "tmdb":
            _remove_outputs(out, step)
        print(f"error: {exc}", file=sys.stderr)
        return 1
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
