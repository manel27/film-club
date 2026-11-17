import unittest

from migration.config import ConfigError
from migration.dupes import DuplicateFilmError, find_duplicates

from . import helpers
from .helpers import film, present_at, rules, scores_of


class InterpretFixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = helpers.run()

    def test_counts(self):
        c = self.result["counts"]
        self.assertEqual(c["sheet_rows"], 11)
        self.assertEqual(c["films"], 11)
        self.assertEqual(c["films_planned"], 1)
        self.assertEqual(c["score_cells"], 19)
        self.assertEqual(c["scores"], 19)
        self.assertEqual(c["present_cells"], 15)
        self.assertEqual(c["attendance"], 15)
        self.assertEqual(c["duplicates"], 0)
        self.assertEqual(c["average_mismatches"], 0)
        self.assertEqual(self.result["needs_decision"], [])

    def test_profiles_include_system_profiles(self):
        names = {p["display_name"]: p for p in self.result["profiles"]}
        self.assertEqual(set(names), {"Alpha", "Bravo", "Dougal", "Manel", "Dora", "Cinema", "Sheet archive"})
        self.assertTrue(names["Cinema"]["is_system"])
        self.assertTrue(names["Sheet archive"]["is_system"])
        self.assertEqual(names["Manel"]["role"], "admin")
        self.assertEqual(names["Dora"]["colour"], "#ee7711")
        self.assertEqual(names["Bravo"]["sheet_keyword"], "Br")

    # colour / tag resolution
    def test_tag_with_matching_colour(self):
        f = film(self.result, 3)
        self.assertEqual((f["title"], f["kind"], f["assigned"]), ("Quiet Orchard", "normal", "Alpha"))
        self.assertEqual(rules(self.result["fixes"], 3), ["score_comma"])

    def test_untagged_row_resolved_by_colour(self):
        f = film(self.result, 2)
        self.assertEqual(f["assigned"], "Manel")
        self.assertIn("assigned_by_colour", rules(self.result["fixes"], 2))

    def test_person_without_column_by_tag(self):
        self.assertEqual(film(self.result, 8)["assigned"], "Dora")  # D on orange: no fix

    def test_d_on_grey_is_fixed(self):
        self.assertEqual(film(self.result, 7)["assigned"], "Dougal")
        self.assertIn("tag_colour_fix", rules(self.result["fixes"], 7))

    def test_tag_colour_mismatch_needs_decision(self):
        data = helpers.sheet()
        helpers.row(data, 3)["title_colour"] = "#3355aa"  # (A) on Bravo's colour
        result = helpers.run(data)
        self.assertEqual(film(result, 3)["assigned"], "Alpha")  # the tag decides
        self.assertEqual(rules(result["needs_decision"]), ["tag_colour_mismatch"])
        self.assertIn("Bravo", result["needs_decision"][0]["detail"])

    def test_unknown_tag_needs_decision(self):
        data = helpers.sheet()
        helpers.row(data, 3)["title_raw"] = "Quiet Orchard (Qq) (A)"
        result = helpers.run(data)
        self.assertEqual(rules(result["needs_decision"]), ["unknown_tag"])
        self.assertEqual(film(result, 3)["assigned"], "Alpha")

    def test_ignored_tag_becomes_label(self):
        data = helpers.sheet()
        helpers.row(data, 3)["title_raw"] = "Quiet Orchard (Sequel) (A)"
        f = film(helpers.run(data), 3)
        self.assertEqual((f["title"], f["labels"]), ("Quiet Orchard", ["Sequel"]))

    def test_secondary_keyword(self):
        data = helpers.sheet()
        helpers.row(data, 11)["title_raw"] = "Twin Echo (B)"
        result = helpers.run(data)
        self.assertEqual(film(result, 11)["assigned"], "Bravo")
        self.assertIn("keyword_alias", rules(result["observations"], 11))

    def test_no_chooser_needs_decision(self):
        data = helpers.sheet()
        helpers.row(data, 2)["title_colour"] = "#123456"
        result = helpers.run(data)
        self.assertEqual(rules(result["needs_decision"]), ["no_chooser"])
        self.assertIsNone(film(result, 2)["assigned"])

    # kinds
    def test_democratico(self):
        f = film(self.result, 4)
        self.assertEqual((f["kind"], f["assigned"], f["turn_holder"]), ("democratico", "Bravo", None))

    def test_misspelt_democratico(self):
        self.assertEqual(film(self.result, 9)["kind"], "democratico")
        self.assertIn("kind_tag_spelling", rules(self.result["fixes"], 9))

    def test_untagged_cinema_goes_to_cinema_profile(self):
        f = film(self.result, 5)
        self.assertEqual((f["kind"], f["assigned"]), ("cinema", "Cinema"))
        self.assertIn("cinema_system", rules(self.result["fixes"], 5))

    def test_tagged_cinema_goes_to_person(self):
        f = film(self.result, 12)
        self.assertEqual((f["title"], f["kind"], f["assigned"]), ("Silver Parade", "cinema", "Bravo"))
        self.assertIn("title_whitespace", rules(self.result["fixes"], 12))

    def test_untagged_maratona_goes_to_default(self):
        f = film(self.result, 6)
        self.assertEqual((f["kind"], f["assigned"]), ("maratona", "Manel"))
        self.assertIn("maratona_default", rules(self.result["fixes"], 6))

    def test_untagged_maratona_without_default_needs_decision(self):
        raw = helpers.overrides()
        del raw["rules"]["maratona_default"]
        result = helpers.run(raw=raw)
        self.assertEqual(rules(result["needs_decision"]), ["no_chooser"])

    def test_day_order_within_a_date(self):
        # The sheet is newest first, so the lower row (6) was shown first.
        self.assertEqual(film(self.result, 6)["day_order"], 1)
        self.assertEqual(film(self.result, 5)["day_order"], 2)

    def test_planned_film(self):
        self.assertTrue(film(self.result, 2)["is_planned"])
        self.assertFalse(film(self.result, 3)["is_planned"])

    # attendance and scores
    def test_attendance(self):
        self.assertEqual(present_at(self.result, 3), {"Alpha", "Bravo", "Manel"})
        self.assertEqual(present_at(self.result, 4), {"Bravo"})  # Alpha scored, not present

    def test_odd_attendance_colour_counts_as_present(self):
        self.assertIn("Alpha", present_at(self.result, 7))
        self.assertIn("odd_attendance_colour", rules(self.result["fixes"], 7))

    def test_scores_with_commas_and_decimals(self):
        self.assertEqual(scores_of(self.result, 3), {"Alpha": "8.00", "Bravo": "7.50", "Manel": "8.25"})
        self.assertEqual(scores_of(self.result, 4), {"Alpha": "6.00", "Bravo": "9.00"})

    def test_small_score_rounded(self):
        self.assertEqual(scores_of(self.result, 7)["Bravo"], "0.01")
        self.assertIn("score_rounded", rules(self.result["fixes"], 7))

    def test_bad_score_needs_decision(self):
        data = helpers.sheet()
        helpers.row(data, 3)["people"]["Alpha"]["text"] = "8/10"
        result = helpers.run(data)
        self.assertEqual(rules(result["needs_decision"]), ["bad_score"])
        self.assertNotIn("Alpha", scores_of(result, 3))

    def test_score_over_ten_needs_decision_unless_easter_egg(self):
        data = helpers.sheet()
        helpers.row(data, 3)["people"]["Alpha"]["text"] = "11"
        result = helpers.run(data)
        self.assertEqual(rules(result["needs_decision"]), ["score_out_of_range"])
        self.assertNotIn("Alpha", scores_of(result, 3))

    def test_easter_egg_scores_kept_and_locked(self):
        f = film(self.result, 9)
        self.assertTrue(f["is_easter_egg"])
        self.assertTrue(f["scores_locked"])
        self.assertEqual(f["assigned"], "Manel")
        self.assertEqual(set(scores_of(self.result, 9).values()), {"11.00"})
        self.assertEqual(len(scores_of(self.result, 9)), 4)
        self.assertEqual(present_at(self.result, 9), set())
        self.assertIn("easter_egg_scores", rules(self.result["fixes"], 9))
        self.assertFalse(film(self.result, 3)["scores_locked"])

    def test_easter_egg_without_override(self):
        raw = helpers.overrides()
        raw["films"] = [f for f in raw["films"] if f["match"].get("title") != "Hollow Kite"]
        result = helpers.run(raw=raw)
        decisions = rules(result["needs_decision"])
        self.assertEqual(decisions.count("score_out_of_range"), 4)
        self.assertIn("no_chooser", decisions)  # black cell, no tag

    # notes
    def test_notes_become_legacy_comments(self):
        self.assertEqual(
            self.result["comments"],
            [
                {"film": 3, "author": "Sheet archive", "body": "Great soundtrack & a bold ending", "is_legacy": True},
                {"film": 9, "author": "Sheet archive", "body": "It's a joke", "is_legacy": True},
            ],
        )

    # year hints and the TMDB hook
    def test_year_hint_from_link_and_tmdb_query(self):
        f = film(self.result, 10)
        self.assertEqual(f["year_hint"], 2001)
        self.assertEqual(f["tmdb_query"], {"query": "Twin Echo", "year": 2001, "language": "en-US", "alternative_queries": []})
        self.assertIsNone(f["tmdb"])

    def test_year_tag(self):
        data = helpers.sheet()
        helpers.row(data, 3)["title_raw"] = "Quiet Orchard (1968) (A)"
        f = film(helpers.run(data), 3)
        self.assertEqual((f["title"], f["year_hint"], f["assigned"]), ("Quiet Orchard", 1968, "Alpha"))


class DuplicatesTest(unittest.TestCase):
    def test_duplicate_without_override_fails(self):
        raw = helpers.overrides()
        raw["films"] = [f for f in raw["films"] if f["match"] != {"row": 11}]
        with self.assertRaises(DuplicateFilmError) as ctx:
            helpers.run(raw=raw)
        self.assertEqual(len(ctx.exception.groups), 1)
        self.assertIn("Twin Echo", str(ctx.exception))

    def test_same_title_different_years_is_allowed(self):
        films = [
            {"legacy_sheet_row": 1, "screened_on": "x", "title": "A", "title_norm": "a", "year_hint": 2000, "source_url": None},
            {"legacy_sheet_row": 2, "screened_on": "y", "title": "A", "title_norm": "a", "year_hint": 2026, "source_url": None},
        ]
        self.assertEqual(find_duplicates(films), [])

    def test_same_title_same_or_unknown_year_clashes(self):
        base = {"screened_on": "x", "title": "A", "title_norm": "a", "source_url": None}
        same = [{**base, "legacy_sheet_row": 1, "year_hint": 2000}, {**base, "legacy_sheet_row": 2, "year_hint": 2000}]
        unknown = [{**base, "legacy_sheet_row": 1, "year_hint": 2000}, {**base, "legacy_sheet_row": 2, "year_hint": None}]
        self.assertEqual(len(find_duplicates(same)), 1)
        self.assertEqual(len(find_duplicates(unknown)), 1)

    def test_accents_and_punctuation_do_not_hide_a_duplicate(self):
        data = helpers.sheet()
        helpers.row(data, 8)["title_raw"] = "Quiet  Orchárd! (D)"
        with self.assertRaises(DuplicateFilmError):
            helpers.run(data)

    def test_same_link_clashes(self):
        base = {"screened_on": "x", "year_hint": None, "source_url": "https://example.org/x"}
        films = [{**base, "legacy_sheet_row": 1, "title": "A", "title_norm": "a"}, {**base, "legacy_sheet_row": 2, "title": "B", "title_norm": "b"}]
        self.assertEqual(len(find_duplicates(films)), 1)


class OverridesTest(unittest.TestCase):
    def test_overrides_are_applied_and_listed(self):
        result = helpers.run()
        self.assertEqual(film(result, 11)["year_hint"], 2024)
        applied = {(o["row"], tuple(sorted(o["set"]))) for o in result["overrides_applied"]}
        self.assertEqual(applied, {(9, ("assigned", "easter_egg")), (11, ("year",))})

    def test_set_fields(self):
        raw = helpers.overrides()
        raw["films"].append(
            {
                "match": {"date": "2026-11-21", "title": "paper harbour"},
                "set": {
                    "title": "Paper Harbour Redux",
                    "kind": "democratico",
                    "assigned": "Alpha",
                    "turn_holder": "Dougal",
                    "present": {"Alpha": True, "Bravo": False},
                    "scores": {"Bravo": None, "Dougal": 6.5},
                },
            }
        )
        raw["films"].append({"match": {"row": 8}, "set": {"exclude": True}})
        result = helpers.run(raw=raw)
        f = film(result, 4)
        self.assertEqual((f["title"], f["assigned"], f["turn_holder"]), ("Paper Harbour Redux", "Alpha", "Dougal"))
        self.assertEqual(present_at(result, 4), {"Alpha"})
        self.assertEqual(scores_of(result, 4), {"Alpha": "6.00", "Dougal": "6.50"})
        self.assertNotIn(8, [f["legacy_sheet_row"] for f in result["films"]])
        self.assertEqual(result["skipped_rows"], [8])

    def test_override_must_match_exactly_one_row(self):
        raw = helpers.overrides()
        raw["films"].append({"match": {"title": "Twin Echo"}, "set": {"year": 1990}})
        with self.assertRaises(ConfigError):
            helpers.run(raw=raw)
        raw["films"][-1] = {"match": {"title": "No Such Film"}, "set": {"year": 1990}}
        with self.assertRaises(ConfigError):
            helpers.run(raw=raw)

    def test_config_validation(self):
        for bad in (
            {"unknown": 1},
            {"people": [{"name": "X", "role": "boss"}]},
            {"rules": {"maratona_default": "Nobody"}},
            {"films": [{"match": {"row": 3}, "set": {"colour": "#fff"}}]},
            {"films": [{"match": {"row": 3}, "set": {"kind": "festival"}}]},
            {"people": [{"name": "A", "keywords": ["K"]}, {"name": "B", "keywords": ["K"]}]},
        ):
            with self.subTest(bad=bad):
                with self.assertRaises(ConfigError):
                    helpers.run(raw=bad)

    def test_turn_holder_only_on_democratico(self):
        raw = helpers.overrides()
        raw["films"].append({"match": {"row": 3}, "set": {"turn_holder": "Bravo"}})
        with self.assertRaises(ConfigError):
            helpers.run(raw=raw)

    def test_without_overrides_columns_still_work(self):
        data = helpers.sheet()
        helpers.row(data, 11)["title_raw"] = "Twin Echo Returns (Br)"
        result = helpers.run(data, raw={})
        self.assertEqual(result["counts"]["score_cells"], 19)
        self.assertEqual(result["counts"]["scores"], 15)  # the 11s need the easter-egg override
        self.assertIn("unknown_tag", rules(result["needs_decision"]))  # keywords unknown


if __name__ == "__main__":
    unittest.main()
