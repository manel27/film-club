"""TMDB matching, preview matches and the importer (synthetic data, no network)."""

from __future__ import annotations

import copy
import io
import json
import os
import tempfile
import unittest
import urllib.error
import zlib

from migration import config as config_mod
from migration import importer, tmdb
from migration.dupes import DuplicateFilmError
from migration.preview import render_html, render_markdown
from migration.tests import helpers


def cand(id_, title, date, votes=100, original=None):
    return {"id": id_, "title": title, "original_title": original or title, "release_date": date, "vote_count": votes}


class ScoreCandidatesTest(unittest.TestCase):
    def test_levels(self):
        exact = [cand(1, "Twin Echo", "2001-05-01"), cand(2, "Twin Echo", "2024-02-02")]
        self.assertEqual(tmdb.score_candidates(exact, ["Twin Echo"], 2024)[:2], (exact[1], "high"))
        self.assertEqual(tmdb.score_candidates(exact, ["Twin Echo"], 2025)[1], "medium")  # one year off
        self.assertEqual(tmdb.score_candidates(exact, ["Twin Echo"], 1990)[1], "low")  # exact title, other year
        other = [cand(3, "Twin Echoes", "2024-01-01")]
        self.assertEqual(tmdb.score_candidates(other, ["Twin Echo"], 2024)[1], "medium")  # same year, other title
        self.assertEqual(tmdb.score_candidates(other, ["Twin Echo"], None)[1], "low")
        self.assertEqual(tmdb.score_candidates([], ["Twin Echo"], None)[:2], (None, "none"))

    def test_no_year_hint_needs_a_clear_favourite(self):
        clear = [cand(1, "Hollow Kite", "1999-01-01", votes=5000), cand(2, "Hollow  Kite!", "2015-01-01", votes=40)]
        self.assertEqual(tmdb.score_candidates(clear, ["Hollow Kite"], None)[:2], (clear[0], "high"))
        close = [cand(1, "Hollow Kite", "1999-01-01", votes=500), cand(2, "Hollow Kite", "2015-01-01", votes=400)]
        self.assertEqual(tmdb.score_candidates(close, ["Hollow Kite"], None)[1], "medium")

    def test_original_title_and_alternative_query_count_as_exact(self):
        c = [cand(1, "Kite of Glass", "2001-01-01", original="Cometa de Vidro")]
        self.assertEqual(tmdb.score_candidates(c, ["Kite Glass", "Cometa de Vidro"], 2001)[1], "high")


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class ClientCacheTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.calls = []
        self.token_reads = 0

    def token(self):
        self.token_reads += 1
        return "test-token"

    def urlopen(self, request, timeout):
        self.calls.append(request.full_url)
        if len(self.calls) == 1 and "fail-once" in request.full_url:
            raise urllib.error.HTTPError(request.full_url, 429, "Too Many", {"Retry-After": "0"}, None)
        return FakeResponse(json.dumps({"results": [], "url": request.full_url}).encode())

    def client(self, token=True):
        return tmdb.Client(self.dir, self.token if token else None, urlopen=self.urlopen, sleep=lambda s: None)

    def test_second_run_is_served_from_the_cache(self):
        first = self.client().get("search/movie", {"query": "Silver Parade", "year": None})
        self.assertEqual(len(self.calls), 1)
        again = self.client(token=False).get("search/movie", {"query": "Silver Parade", "year": None})
        self.assertEqual(first, again)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.token_reads, 1)
        cached = json.load(open(os.path.join(self.dir, os.listdir(self.dir)[0])))
        self.assertNotIn("test-token", json.dumps(cached))

    def test_retries_on_429(self):
        self.client().get("search/movie", {"query": "fail-once"})
        self.assertEqual(len(self.calls), 2)

    def test_error_does_not_echo_the_token(self):
        def denied(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)

        client = tmdb.Client(self.dir, self.token, urlopen=denied, sleep=lambda s: None)
        with self.assertRaises(tmdb.TmdbError) as ctx:
            client.get("movie/1", {})
        self.assertNotIn("test-token", str(ctx.exception))


class FakeTmdb:
    """Serves search results and details for the fixture's films."""

    def __init__(self):
        self.fetched_at = "2026-11-20T00:00:00Z"

    def get(self, path, params):
        if path == "search/movie":
            title = params["query"]
            if title == "Velvet Comet":
                return {"results": []}
            id_ = zlib.crc32(title.lower().encode()) % 900000 + 1
            year = params.get("year") or 1999
            return {"results": [cand(id_ + (year if title == "Twin Echo" else 0), title, f"{year}-03-01")]}
        id_ = int(path.split("/")[1])
        return {"id": id_, "title": f"Film {id_}", "release_date": "1999-03-01", "poster_path": "/p.jpg", "credits": {"crew": [{"job": "Director", "name": "D. Rector"}]}}


def fixture_matches(data=None):
    data = data or helpers.run()
    pins = config_mod.from_dict(helpers.overrides()).tmdb
    pins["2026-12-05|velvet comet"] = {"no_tmdb": True, "year": 2026}
    return tmdb.match_all(data, FakeTmdb(), pins)


class MatchAllTest(unittest.TestCase):
    def test_pins_and_counts(self):
        result = fixture_matches()
        m = result["matches"]
        self.assertEqual(m["2026-10-24|hollow kite"]["tmdb_id"], 123456)
        self.assertTrue(m["2026-10-24|hollow kite"]["pinned"])
        self.assertEqual(m["2026-11-07|copper lantern"], {**m["2026-11-07|copper lantern"], "tmdb_id": None, "release_year": 2011})
        self.assertEqual(m["2026-10-03|silver parade"]["directors"], ["D. Rector"])
        self.assertEqual(sum(result["counts"][lvl] for lvl in tmdb.CONFIDENCE_LEVELS), 11)

    def test_duplicate_tmdb_ids_fail(self):
        data = helpers.run()
        pins = {"2026-10-03|silver parade": {"tmdb_id": 7}, "2026-10-31|amber signal": {"tmdb_id": 7}}
        with self.assertRaises(DuplicateFilmError):
            tmdb.match_all(data, FakeTmdb(), pins)

    def test_bad_pin_is_rejected(self):
        for bad in ({"tmdb_id": "x"}, {"no_tmdb": True}, {"tmdb_id": 3, "no_tmdb": True, "year": 2000}):
            with self.assertRaises(config_mod.ConfigError):
                config_mod.from_dict({"tmdb": {"k": bad}})

    def test_preview_lists_matches_to_check(self):
        data = helpers.run()
        matches = fixture_matches(data)
        page = render_html(data, matches)
        self.assertIn("Check these matches", page)
        self.assertIn("image.tmdb.org/t/p/w92/p.jpg", page)
        md = render_markdown(data, matches)
        self.assertIn(f"## Check these matches ({matches['counts']['to_check']})", md)


class FakeDb:
    """In-memory stand-in for PostgREST, with the scores lock rule."""

    def __init__(self):
        self.tables = {t: [] for t in ("profiles", "films", "attendance", "scores", "comments")}
        self.writes = []
        self.next_id = 1

    def select(self, table, columns, order):
        return [{c: r.get(c) for c in columns.split(",")} for r in self.tables[table]]

    def insert(self, table, rows, returning=None):
        self.writes.append(("insert", table))
        out = []
        for row in rows:
            row = dict(row)
            if table in ("profiles", "films", "comments"):
                row["id"] = f"p{self.next_id}" if table == "profiles" else self.next_id
                self.next_id += 1
            if table == "films":
                row.setdefault("scores_locked", False)
            if table == "scores" and self._locked(row["film_id"]):
                raise RuntimeError("locked")
            self.tables[table].append(row)
            out.append(row)
        return out

    def update(self, table, match, values):
        self.writes.append(("update", table))
        for row in self.tables[table]:
            if all(row.get(k) == v for k, v in match.items()):
                if table == "scores" and self._locked(row["film_id"]):
                    raise RuntimeError("locked")
                row.update(values)

    def _locked(self, film_id):
        return any(f["id"] == film_id and f["scores_locked"] for f in self.tables["films"])


class ImporterTest(unittest.TestCase):
    def setUp(self):
        self.data = helpers.run()
        self.matches = fixture_matches(self.data)["matches"]

    def test_order_then_idempotent(self):
        db = FakeDb()
        db.tables["profiles"].append({"id": "existing", "display_name": "manel ", "sheet_keyword": None, "colour": None, "is_system": False})
        log = []
        importer.run_import(self.data, self.matches, db, log=log.append)
        first_seen = []
        for _, table in db.writes:
            if table not in first_seen:
                first_seen.append(table)
        self.assertEqual(first_seen, ["profiles", "films", "attendance", "scores", "comments"])
        self.assertEqual(db.writes[-1], ("update", "films"))  # the lock comes last
        manel = [p for p in db.tables["profiles"] if p["display_name"].strip().lower() == "manel"]
        self.assertEqual(len(manel), 1)  # the existing profile was kept
        self.assertEqual(manel[0]["id"], "existing")
        self.assertIsNotNone(manel[0]["sheet_keyword"])
        self.assertEqual(len(db.tables["films"]), 11)
        self.assertEqual(len(db.tables["scores"]), 19)
        self.assertEqual(sum(f["scores_locked"] for f in db.tables["films"]), 1)

        db.writes.clear()
        written = importer.run_import(self.data, self.matches, db, log=log.append)
        self.assertEqual(db.writes, [])
        self.assertEqual(sum(written.values()), 0)

    def test_dry_run_writes_nothing(self):
        db = FakeDb()
        written = importer.run_import(self.data, self.matches, db, dry_run=True, log=lambda s: None)
        self.assertEqual(db.writes, [])
        self.assertEqual(written["films"], 11)
        self.assertEqual(written["attendance"], 15)

    def test_count_mismatch_fails_loudly(self):
        data = copy.deepcopy(self.data)
        data["counts"]["scores"] += 1
        with self.assertRaises(importer.CountMismatch):
            importer.run_import(data, self.matches, FakeDb(), log=lambda s: None)

    def test_refuses_open_decisions_and_missing_years(self):
        data = copy.deepcopy(self.data)
        data["needs_decision"] = [{"label": "x"}]
        with self.assertRaises(importer.ImportRefused):
            importer.run_import(data, self.matches, FakeDb())
        matches = copy.deepcopy(self.matches)
        matches["2026-10-03|silver parade"] = {"tmdb_id": None, "release_year": None, "confidence": "none", "pinned": False}
        with self.assertRaisesRegex(importer.ImportRefused, "no year"):
            importer.run_import(self.data, matches, FakeDb())
        db = FakeDb()
        with self.assertRaises(importer.ImportRefused):
            importer.run_import(self.data, {}, db)
        self.assertEqual(db.writes, [])

    def test_refuses_non_local_hosts(self):
        importer.check_target("http://127.0.0.1:54321", True, False, None)
        with self.assertRaisesRegex(importer.ImportRefused, "--production"):
            importer.check_target("https://abc.supabase.co", False, False, lambda p: "abc.supabase.co")
        with self.assertRaisesRegex(importer.ImportRefused, "interactive"):
            importer.check_target("https://abc.supabase.co", False, True, None)
        with self.assertRaisesRegex(importer.ImportRefused, "cancelled"):
            importer.check_target("https://abc.supabase.co", False, True, lambda p: "abc")
        importer.check_target("https://abc.supabase.co", False, True, lambda p: "abc.supabase.co")

    def test_env_file(self):
        folder = tempfile.mkdtemp()
        path = os.path.join(folder, "import.env")

        def write(text):
            with open(path, "w") as fh:
                fh.write(text)

        no_git = lambda args, cwd: 128  # noqa: E731 - not inside a repository
        write("SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=sb_secret_abc\n")
        self.assertEqual(importer.read_env(path, no_git), ("http://127.0.0.1:54321", "sb_secret_abc", True))
        write("SUPABASE_URL=http://example.com\nSUPABASE_SECRET_KEY=sb_secret_abc\n")
        with self.assertRaisesRegex(importer.ImportRefused, "https"):
            importer.read_env(path, no_git)
        write("SUPABASE_URL=https://example.com\nSUPABASE_SECRET_KEY=sb_publishable_abc\n")
        with self.assertRaises(importer.ImportRefused) as ctx:
            importer.read_env(path, no_git)
        self.assertNotIn("sb_publishable_abc", str(ctx.exception))
        not_ignored = lambda args, cwd: 0 if args[0] == "rev-parse" else 1  # noqa: E731
        with self.assertRaisesRegex(importer.ImportRefused, "not git-ignored"):
            importer.read_env(path, not_ignored)


if __name__ == "__main__":
    unittest.main()
