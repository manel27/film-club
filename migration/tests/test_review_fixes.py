"""Tests for the review round: overrides validation, stale outputs, clean
errors, reproducibility, legacy keys, the easter-egg lock order and the
new needs-decision cases. Synthetic fixture only."""

import contextlib
import io
import os
import tempfile
import unittest

from migration import cli
from migration.config import ConfigError
from migration.preview import render_markdown

from . import helpers
from .helpers import film, present_at, rules, scores_of

OUTPUTS = ["import.json", "preview.html", "preview.md", "sheet.json"]


def _cli(*args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(list(args))
    return code, err.getvalue()


def _yaml(folder, text, name="overrides.yaml"):
    path = os.path.join(folder, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


def _example_text():
    with open(helpers.EXAMPLE_OVERRIDES, encoding="utf-8") as fh:
        return fh.read()


class ScoreOverrideTest(unittest.TestCase):
    def _with_scores(self, row, scores):
        raw = helpers.overrides()
        raw["films"].append({"match": {"row": row}, "set": {"scores": scores}})
        return raw

    def test_values_parsed_like_sheet_cells(self):
        result = helpers.run(raw=self._with_scores(3, {"Alpha": "7,125", "Dougal": 6.5, "Bravo": 9}))
        self.assertEqual(scores_of(result, 3), {"Alpha": "7.13", "Bravo": "9.00", "Dougal": "6.50", "Manel": "8.25"})

    def test_bad_values_are_config_errors(self):
        for bad in ("eight", True, [7], {"x": 1}):
            with self.subTest(bad=bad), self.assertRaises(ConfigError):
                helpers.run(raw=self._with_scores(3, {"Alpha": bad}))

    def test_range_checked_unless_easter_egg(self):
        with self.assertRaises(ConfigError):
            helpers.run(raw=self._with_scores(3, {"Alpha": 10.5}))
        with self.assertRaises(ConfigError):
            helpers.run(raw=self._with_scores(3, {"Alpha": -1}))
        result = helpers.run(raw=self._with_scores(9, {"Alpha": 11}))  # the easter egg
        self.assertEqual(scores_of(result, 9)["Alpha"], "11.00")


class StaleOutputTest(unittest.TestCase):
    def test_failed_interpret_removes_previous_outputs(self):
        with tempfile.TemporaryDirectory() as out:
            ok = _cli("all", "--sheet", helpers.FIXTURE, "--out", out, "--overrides", helpers.EXAMPLE_OVERRIDES)
            self.assertEqual(ok[0], 0)
            self.assertEqual(sorted(os.listdir(out)), OUTPUTS)
            # No overrides -> duplicate films -> exit 3; old import/preview must go.
            code, err = _cli("all", "--sheet", helpers.FIXTURE, "--out", out)
            self.assertEqual(code, 3)
            self.assertEqual(sorted(os.listdir(out)), ["sheet.json"])

    def test_failed_parse_removes_everything(self):
        with tempfile.TemporaryDirectory() as out, tempfile.TemporaryDirectory() as src:
            _cli("all", "--sheet", helpers.FIXTURE, "--out", out, "--overrides", helpers.EXAMPLE_OVERRIDES)
            not_a_sheet = _yaml(src, "<html><body>nothing here</body></html>", "x.html")
            code, err = _cli("all", "--sheet", not_a_sheet, "--out", out)
            self.assertEqual(code, 1)
            self.assertEqual(os.listdir(out), [])

    def test_no_temporary_files_left(self):
        with tempfile.TemporaryDirectory() as out:
            _cli("all", "--sheet", helpers.FIXTURE, "--out", out, "--overrides", helpers.EXAMPLE_OVERRIDES)
            self.assertFalse([n for n in os.listdir(out) if n.endswith(".tmp")])


class CleanErrorTest(unittest.TestCase):
    def assertCleanError(self, *args):
        code, err = _cli(*args)
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("error: "), err)
        self.assertNotIn("Traceback", err)
        return err

    def _overrides(self, folder, text):
        return ("all", "--sheet", helpers.FIXTURE, "--out", os.path.join(folder, "out"), "--overrides", _yaml(folder, text))

    def test_malformed_yaml(self):
        with tempfile.TemporaryDirectory() as d:
            err = self.assertCleanError(*self._overrides(d, "people: [unclosed\n  - x: : :\n"))
            self.assertIn("not valid YAML", err)

    def test_bad_today(self):
        with tempfile.TemporaryDirectory() as d:
            err = self.assertCleanError("all", "--sheet", helpers.FIXTURE, "--out", d, "--today", "2026-13-40")
            self.assertIn("--today", err)

    def test_bad_today_in_overrides(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertCleanError(*self._overrides(d, "today: someday\n"))

    def test_non_mapping_tag_colour_fixes(self):
        with tempfile.TemporaryDirectory() as d:
            err = self.assertCleanError(*self._overrides(d, "rules:\n  tag_colour_fixes: [D-on-grey]\n"))
            self.assertIn("tag_colour_fixes[0]", err)

    def test_wrongly_typed_override_title_and_year(self):
        for text in (
            "films:\n  - match: { title: 1234 }\n    set: { year: 2000 }\n",
            "films:\n  - match: { row: 3 }\n    set: { title: [a, b] }\n",
            "films:\n  - match: { row: 3 }\n    set: { year: 'nineteen' }\n",
            "films:\n  - match: { row: 3 }\n    set: { year: 99999 }\n",
            "films:\n  - match: { row: '3' }\n    set: { year: 2000 }\n",
            "films:\n  - match: { row: 3 }\n    set: [year]\n",
        ):
            with self.subTest(text=text), tempfile.TemporaryDirectory() as d:
                self.assertCleanError(*self._overrides(d, text))

    def test_out_inside_repo_refused(self):
        repo = cli.REPO_ROOT
        for path in (repo, os.path.join(repo, "migration"), os.path.join(repo, "src", "out")):
            with self.subTest(path=path):
                err = self.assertCleanError("parse", "--sheet", helpers.FIXTURE, "--out", path)
                self.assertIn("inside the repository", err)
        self.assertFalse(os.path.exists(os.path.join(repo, "migration", "sheet.json")))

    def test_out_allowed_in_migration_out_and_outside_repo(self):
        allowed = os.path.join(cli.REPO_ROOT, "migration", "out", "sub")
        self.assertEqual(cli.check_out_dir(allowed), os.path.realpath(allowed))
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(cli.check_out_dir(d), os.path.realpath(d))


class ReproducibilityTest(unittest.TestCase):
    def test_two_runs_are_byte_identical(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            for out in (a, b):
                code, _ = _cli("all", "--sheet", helpers.FIXTURE, "--out", out, "--overrides", helpers.EXAMPLE_OVERRIDES)
                self.assertEqual(code, 0)
            for name in OUTPUTS:
                with open(os.path.join(a, name), "rb") as fa, open(os.path.join(b, name), "rb") as fb:
                    self.assertEqual(fa.read(), fb.read(), name)

    def test_today_from_overrides_and_cli(self):
        with tempfile.TemporaryDirectory() as d:
            path = _yaml(d, _example_text())  # today: 2026-12-01
            out = os.path.join(d, "out")
            _cli("all", "--sheet", helpers.FIXTURE, "--out", out, "--overrides", path)
            with open(os.path.join(out, "preview.md"), encoding="utf-8") as fh:
                md = fh.read()
            self.assertIn("**As of 2026-12-01**", md)
            self.assertIn("(1 planned)", md)
            with open(os.path.join(out, "preview.html"), encoding="utf-8") as fh:
                self.assertIn("as of 2026-12-01", fh.read())
            # --today wins over the file
            _cli("interpret", "--out", out, "--overrides", path, "--today", "2026-12-31")
            _cli("preview", "--out", out)
            with open(os.path.join(out, "preview.md"), encoding="utf-8") as fh:
                md = fh.read()
            self.assertIn("**As of 2026-12-31**", md)
            self.assertIn("(0 planned)", md)


class LegacyKeyTest(unittest.TestCase):
    def test_keys_are_date_and_normalised_title(self):
        result = helpers.run()
        self.assertEqual(film(result, 3)["legacy_key"], "2026-11-28|quiet orchard")
        self.assertEqual(film(result, 12)["legacy_key"], "2026-10-03|silver parade")
        keys = [f["legacy_key"] for f in result["films"]]
        self.assertEqual(len(keys), len(set(keys)))
        for table in ("attendance", "scores", "comments"):
            self.assertTrue(result[table])
            self.assertTrue({r["film"] for r in result[table]} <= set(keys), table)

    def test_key_does_not_depend_on_the_row_number(self):
        data = helpers.sheet()
        for r in data["rows"]:
            r["sheet_row"] += 100  # e.g. new rows added at the top of the sheet
        raw = helpers.overrides()
        raw["films"] = [f for f in raw["films"] if "row" not in f["match"]]
        raw["films"].append({"match": {"row": 111}, "set": {"year": 2024}})
        before = {f["legacy_key"] for f in helpers.run().get("films")}
        after = {f["legacy_key"] for f in helpers.run(data, raw)["films"]}
        self.assertEqual(before, after)


class NewDecisionsTest(unittest.TestCase):
    def test_untagged_cinema_on_member_colour(self):
        data = helpers.sheet()
        helpers.row(data, 5)["title_colour"] = "#aa3355"  # Alpha's colour
        result = helpers.run(data)
        self.assertEqual(rules(result["needs_decision"]), ["cinema_member_colour"])
        self.assertIsNone(film(result, 5)["assigned"])

    def test_untagged_maratona_on_other_member_colour(self):
        data = helpers.sheet()
        helpers.row(data, 6)["title_colour"] = "#aa3355"  # Alpha, not the default (Manel)
        result = helpers.run(data)
        self.assertEqual(rules(result["needs_decision"]), ["maratona_member_colour"])
        self.assertIsNone(film(result, 6)["assigned"])

    def test_untagged_maratona_on_default_person_colour_is_fine(self):
        data = helpers.sheet()
        helpers.row(data, 6)["title_colour"] = "#2244ee"  # Manel's colour
        result = helpers.run(data)
        self.assertEqual(result["needs_decision"], [])
        self.assertEqual(film(result, 6)["assigned"], "Manel")

    def test_column_missing_from_roster(self):
        raw = helpers.overrides()
        raw["people"] = [p for p in raw["people"] if p["name"] != "Dougal"]
        raw["rules"]["tag_colour_fixes"] = []
        result = helpers.run(raw=raw)
        missing = [e for e in result["needs_decision"] if e["rule"] == "unknown_column"]
        self.assertEqual(len(missing), 1)
        self.assertIn("Dougal", missing[0]["detail"])
        self.assertIn("Dougal", present_at(result, 7))  # data kept meanwhile

    def test_unknown_tag_with_unmatched_colour(self):
        data = helpers.sheet()
        helpers.row(data, 2)["title_raw"] = "Velvet Comet (Qq)"
        helpers.row(data, 2)["title_colour"] = "#123456"
        result = helpers.run(data)
        self.assertEqual(sorted(rules(result["needs_decision"])), ["no_chooser", "unknown_tag"])
        self.assertIsNone(film(result, 2)["assigned"])


class AssignedOverrideTest(unittest.TestCase):
    def test_superseded_auto_fixes_are_dropped(self):
        raw = helpers.overrides()
        raw["films"] += [
            {"match": {"row": 2}, "set": {"assigned": "Alpha"}},  # was assigned_by_colour
            {"match": {"row": 7}, "set": {"assigned": "Dora"}},  # was tag_colour_fix
            {"match": {"row": 6}, "set": {"assigned": "Bravo"}},  # was maratona_default
        ]
        result = helpers.run(raw=raw)
        fixes = rules(result["fixes"])
        for rule in ("assigned_by_colour", "tag_colour_fix", "maratona_default"):
            self.assertNotIn(rule, fixes)
        self.assertIn("planned_film", rules(result["fixes"], 2))  # unrelated fixes stay
        self.assertEqual(film(result, 7)["assigned"], "Dora")


class FixtureDetailsTest(unittest.TestCase):
    def test_average_mismatch_detected(self):
        data = helpers.sheet()
        helpers.row(data, 3)["average_raw"] = "5.00"
        result = helpers.run(data)
        self.assertEqual(result["counts"]["average_mismatches"], 1)
        self.assertEqual(rules(result["observations"], 3), ["average_mismatch"])

    def test_three_films_on_one_day(self):
        data = helpers.sheet()
        helpers.row(data, 4)["date"] = "2026-11-14"  # rows 4, 5 and 6 on one day
        result = helpers.run(data)
        self.assertEqual([film(result, r)["day_order"] for r in (6, 5, 4)], [1, 2, 3])

    def test_note_entity_and_line_break(self):
        body = next(c["body"] for c in helpers.run()["comments"] if c["film"].endswith("hollow kite"))
        self.assertEqual(body, "It's a\njoke <3")

    def test_markdown_escapes_raw_html(self):
        data = helpers.sheet()
        helpers.row(data, 3)["notes"] = "<img src=x onerror=alert(1)> | done"
        md = render_markdown(helpers.run(data))
        self.assertNotIn("<img", md)
        self.assertIn("&lt;img src=x onerror=alert(1)&gt; \\| done", md)
        self.assertIn("joke &lt;3", md)


if __name__ == "__main__":
    unittest.main()
