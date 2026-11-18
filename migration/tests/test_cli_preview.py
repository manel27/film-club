import contextlib
import io
import json
import os
import tempfile
import unittest

from migration.cli import main
from migration.preview import render_html, render_markdown

from . import helpers


def _run_cli(*args):
    err = io.StringIO()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
        code = main(list(args))
    return code, err.getvalue()


class CliTest(unittest.TestCase):
    def test_all_writes_every_output(self):
        with tempfile.TemporaryDirectory() as out:
            code, _ = _run_cli(
                "all", "--sheet", helpers.FIXTURE, "--out", out, "--overrides", helpers.EXAMPLE_OVERRIDES, "--today", "2026-12-01"
            )
            self.assertEqual(code, 0)
            self.assertEqual(sorted(os.listdir(out)), ["import.json", "preview.html", "preview.md", "sheet.json"])
            with open(os.path.join(out, "import.json"), encoding="utf-8") as fh:
                data = json.load(fh)
            self.assertEqual(data["format"], "film-club-import/1")
            self.assertEqual(data["counts"]["films"], 11)

    def test_steps_run_separately(self):
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(_run_cli("parse", "--sheet", helpers.FIXTURE, "--out", out)[0], 0)
            self.assertEqual(_run_cli("interpret", "--out", out, "--overrides", helpers.EXAMPLE_OVERRIDES)[0], 0)
            self.assertEqual(_run_cli("preview", "--out", out)[0], 0)

    def test_duplicates_exit_code(self):
        with tempfile.TemporaryDirectory() as out:
            code, err = _run_cli("all", "--sheet", helpers.FIXTURE, "--out", out)  # no overrides: duplicate
            self.assertEqual(code, 3)
            self.assertIn("duplicate", err)
            self.assertFalse(os.path.exists(os.path.join(out, "import.json")))

    def test_parse_needs_sheet(self):
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(_run_cli("parse", "--out", out)[0], 1)


class PreviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = helpers.run()

    def test_html_sections_and_escaping(self):
        data = helpers.sheet()
        helpers.row(data, 3)["notes"] = "<script>alert(1)</script>"
        page = render_html(helpers.run(data))
        self.assertNotIn("<script>", page)
        self.assertIn("&lt;script&gt;", page)
        for heading in ("Needs your decision", "Sanity counts", "People", "Automatic fixes", "Films (11)", "Observations"):
            self.assertIn(heading, page)
        self.assertIn("background:#aa3355", page)  # person swatch
        self.assertIn("scores locked", page)

    def test_html_has_no_external_resources(self):
        page = render_html(self.result)
        self.assertNotIn("<script", page)
        self.assertNotIn("<link", page)
        self.assertNotIn("src=", page)

    def test_markdown(self):
        md = render_markdown(self.result)
        self.assertIn("## Needs your decision", md)
        self.assertIn("| Alpha | `#aa3355` | A | member | 2 |", md)  # chose Quiet Orchard and Twin Echo
        self.assertIn("Bravo 0.01*", md)  # scored, not present
        self.assertIn("| Score cells in the sheet | 19 | 19 | match |", md)

    def test_sanity_mismatch_is_flagged(self):
        result = dict(self.result, expected={"rows": 12})
        self.assertIn("**differs**", render_markdown(result))


if __name__ == "__main__":
    unittest.main()
