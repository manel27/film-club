import unittest

from migration.parse_sheet import SheetFormatError, css_colour_map, is_coloured, parse_html
from migration.text import https_url, parse_link, parse_score, split_tags, title_norm

from . import helpers


class ParseSheetTest(unittest.TestCase):
    def setUp(self):
        self.sheet = helpers.sheet()

    def test_rows_and_columns(self):
        self.assertEqual(len(self.sheet["rows"]), 11)  # header, freeze bar and empty row skipped
        self.assertEqual([p["name"] for p in self.sheet["columns"]["people"]], ["Alpha", "Bravo", "Dougal", "Manel"])
        self.assertEqual(self.sheet["columns"]["people"][0]["colour"], "#aa3355")
        self.assertEqual(self.sheet["merged_cells"], 0)
        self.assertEqual([r["sheet_row"] for r in self.sheet["rows"]][:3], [2, 3, 4])

    def test_cells(self):
        r = helpers.row(self.sheet, 3)
        self.assertEqual(r["date"], "2026-11-28")
        self.assertEqual(r["title_raw"], "Quiet Orchard (A)")
        self.assertEqual(r["title_colour"], "#aa3355")
        self.assertEqual(r["people"]["Bravo"], {"text": "7,5", "colour": "#3355aa", "coloured": True})
        self.assertFalse(r["people"]["Dougal"]["coloured"])  # banding grey
        self.assertEqual(r["average_raw"], "7.92")
        # softmerge class + nested markup + entity
        self.assertEqual(r["notes"], "Great soundtrack & a bold ending")

    def test_link_and_line_break(self):
        self.assertEqual(helpers.row(self.sheet, 10)["link"], "https://en.wikipedia.org/wiki/Twin_Echo_(2001_film)")
        self.assertEqual(helpers.row(self.sheet, 10)["title_raw"], "Twin Echo (A)")
        self.assertEqual(helpers.row(self.sheet, 12)["title_raw"], " Silver\nParade  (Cinema) (Br)")

    def test_cell_without_class_is_uncoloured(self):
        cell = helpers.row(self.sheet, 2)["people"]["Dougal"]
        self.assertEqual(cell, {"text": "", "colour": None, "coloured": False})

    def test_colour_map_and_banding(self):
        colours = css_colour_map(".ritz .waffle .s1{color:#000;background-color:#ABC;}")
        self.assertEqual(colours, {"s1": "#aabbcc"})
        self.assertFalse(is_coloured("#ffffff"))
        self.assertFalse(is_coloured("#f3f3f3"))
        self.assertFalse(is_coloured(None))
        self.assertTrue(is_coloured("#000000"))

    def test_rejects_other_html(self):
        with self.assertRaises(SheetFormatError):
            parse_html("<html><body><table><tr><td>x</td></tr></table></body></html>")

    def test_scripts_are_not_cell_text(self):
        # The parser only reads text; markup such as <script> never runs and
        # sits outside the table here.
        with open(helpers.FIXTURE, encoding="utf-8") as fh:
            html = fh.read().replace("<body>", "<body><script>alert(1)</script>")
        self.assertEqual(len(parse_html(html)["rows"]), 11)


class TextTest(unittest.TestCase):
    def test_split_tags(self):
        self.assertEqual(split_tags("Film (Democrático) (B) "), ("Film", ["Democrático", "B"]))
        self.assertEqual(split_tags("Film(Maratona)"), ("Film", ["Maratona"]))
        self.assertEqual(split_tags("A (Part) Film (X)"), ("A (Part) Film", ["X"]))
        self.assertEqual(split_tags("(Only brackets)"), ("(Only brackets)", []))

    def test_title_norm(self):
        self.assertEqual(title_norm("  Émile: Part II!  "), "emile part ii")
        self.assertEqual(title_norm("Wallace & Gromit"), "wallace gromit")

    def test_scores(self):
        self.assertEqual(str(parse_score("7,5").value), "7.50")
        self.assertTrue(parse_score("7,5").comma)
        self.assertEqual(str(parse_score(" 8.25 ").value), "8.25")
        self.assertFalse(parse_score("8").rounded)
        rounded = parse_score("0.006")
        self.assertEqual(str(rounded.value), "0.01")
        self.assertTrue(rounded.rounded)
        self.assertEqual(str(parse_score("7.125").value), "7.13")  # half up, like numeric(4,2)
        self.assertIsNone(parse_score("  "))
        self.assertEqual(parse_score("n/a").error, "not a number")

    def test_links(self):
        link = parse_link("https://en.wikipedia.org/wiki/Twin_Echo_(2001_film)")
        self.assertEqual((link.title, link.year, link.is_film_page), ("Twin Echo", 2001, True))
        link = parse_link("https://pt.wikipedia.org/wiki/Velvet_Comet_(filme_de_1999)")
        self.assertEqual((link.title, link.year), ("Velvet Comet", 1999))
        link = parse_link("https://en.wikipedia.org/wiki/Paper_Harbour_(novel)")
        self.assertEqual((link.year, link.is_film_page), (None, False))
        link = parse_link("https://letterboxd.com/film/iron-tulip-1984/")
        self.assertEqual((link.site, link.title, link.year), ("letterboxd", "iron tulip", 1984))
        self.assertIsNone(parse_link(None))

    def test_https_url(self):
        # Matches the films_source_url_https CHECK: only https (or nothing) is stored.
        self.assertEqual(https_url("https://letterboxd.com/film/x/"), "https://letterboxd.com/film/x/")
        self.assertEqual(https_url(" HTTP://en.wikipedia.org/wiki/X "), "https://en.wikipedia.org/wiki/X")
        self.assertEqual(https_url("Https://x.test"), "https://x.test")
        for bad in (None, "", "javascript:alert(1)", "ftp://x.test/a", "//x.test/a", "/wiki/X"):
            self.assertIsNone(https_url(bad), bad)


if __name__ == "__main__":
    unittest.main()
