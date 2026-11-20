"""Step 5: write ``import.json`` + ``matches.json`` into Supabase (plan §2.7).

Talks to PostgREST over HTTPS with the **secret key**, read from a
git-ignored env file (``SUPABASE_URL``, ``SUPABASE_SECRET_KEY``). The key is
never printed. Non-local hosts are refused unless ``--production`` is given
and the host is typed at a terminal prompt (the create-admin pattern).

Idempotent: it reads what is already there and only inserts what is missing
or patches what differs, so a second run writes nothing. Films are found by
their natural keys (TMDB id; title + year for films without TMDB; sheet row +
date as a fallback), profiles by name, the rest by their primary keys.
It never deletes anything.

Order (plan §4.4): profiles -> films -> attendance -> scores -> legacy
comments -> lock the easter egg (scores first, then the lock).
"""

from __future__ import annotations

import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from decimal import Decimal
from typing import Any, Callable

from .text import title_norm

LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]", "::1")
PAGE = 1000  # PostgREST max_rows
FILM_FIELDS = (
    "tmdb_id", "title", "original_title", "release_year", "release_date", "poster_path", "backdrop_path",
    "overview", "runtime_min", "genres", "directors", "source_url", "screened_on", "kind", "assigned_id",
    "turn_holder_id", "day_order", "is_easter_egg", "legacy_sheet_row",
)  # fmt: skip


class ImportRefused(ValueError):
    """The import must not run (bad target, open decisions, missing data)."""


class CountMismatch(RuntimeError):
    """The database doesn't hold what the preview promised."""


# ------------------------------------------------------------------ env + target


def read_env(path: str, git: Callable[[list[str], str], int] | None = None) -> tuple[str, str, bool]:
    """``(url, secret_key, is_local)`` from a git-ignored env file. Errors name
    the variable, never its value."""
    import os

    real = os.path.realpath(path)
    git = git or _git_status
    if git(["rev-parse", "--is-inside-work-tree"], os.path.dirname(real)) == 0:
        # Inside a repo: git must positively confirm the file is ignored (a tracked file never is).
        if git(["check-ignore", "--quiet", "--", real], os.path.dirname(real)) != 0:
            raise ImportRefused(f"{path} is inside a git repository and not git-ignored; keep it outside the repo")
    env: dict[str, str] = {}
    try:
        with open(real, encoding="utf-8") as fh:
            for line in fh:
                name, sep, value = line.strip().partition("=")
                if sep and not name.startswith("#"):
                    env[name.strip()] = value.strip().strip("'\"")
    except OSError:
        raise ImportRefused(f"can't read the env file {path}") from None
    url, key = env.get("SUPABASE_URL", ""), env.get("SUPABASE_SECRET_KEY", "")
    missing = [n for n, v in (("SUPABASE_URL", url), ("SUPABASE_SECRET_KEY", key)) if not v]
    if missing:
        raise ImportRefused(f"the env file is missing {' and '.join(missing)}")
    parts = urllib.parse.urlsplit(url)
    is_local = parts.hostname in LOCAL_HOSTS
    if parts.scheme != "https" and not (parts.scheme == "http" and is_local):
        raise ImportRefused("SUPABASE_URL must be https (plain http only for a local stack)")
    if key.startswith("sb_publishable_") or not (key.startswith("sb_secret_") or key.startswith("eyJ")):
        raise ImportRefused("SUPABASE_SECRET_KEY doesn't look like a Supabase secret key")
    return f"{parts.scheme}://{parts.netloc}", key, is_local


def _git_status(args: list[str], cwd: str) -> int:
    try:
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True).returncode
    except OSError:
        return -1


def check_target(url: str, is_local: bool, production: bool, prompt: Callable[[str], str] | None) -> None:
    """Local stacks are fine. Anything else needs ``--production`` and the host
    typed at an interactive prompt (``prompt`` is None without a TTY)."""
    if is_local:
        return
    host = urllib.parse.urlsplit(url).netloc
    if not production:
        raise ImportRefused(f"{host} is not a local stack; pass --production to import there (owner gate)")
    if prompt is None:
        raise ImportRefused("a production import needs an interactive terminal to confirm the host")
    if prompt(f'This is NOT a local stack. Type "{host}" to continue: ').strip() != host:
        raise ImportRefused("cancelled; nothing was changed")


def check_ready(data: dict[str, Any], matches: dict[str, dict[str, Any]]) -> None:
    """Refuse while decisions are open or a film has no year (plan N1)."""
    problems = []
    if data["needs_decision"]:
        problems.append(f"{len(data['needs_decision'])} item(s) still need a decision (see the preview)")
    unmatched = [f["legacy_key"] for f in data["films"] if f["legacy_key"] not in matches]
    if unmatched:
        problems.append(f"{len(unmatched)} film(s) have no TMDB match entry; run the tmdb step: {unmatched[:5]}")
    no_year = [k for k, m in matches.items() if not m.get("tmdb_id") and not m.get("release_year")]
    if no_year:
        problems.append(
            f"{len(no_year)} film(s) have no TMDB match and no year; give them a tmdb_id or no_tmdb + year "
            f"in the overrides file: {sorted(no_year)[:5]}"
        )
    if problems:
        raise ImportRefused("; ".join(problems))


# ------------------------------------------------------------------ PostgREST


class Rest:
    """Minimal PostgREST client (secret key). Errors carry the status and
    PostgREST's message, never the request headers."""

    def __init__(self, url: str, key: str, urlopen: Callable[..., Any] = urllib.request.urlopen):
        self.base = url.rstrip("/") + "/rest/v1/"
        self.headers = {"apikey": key, "Content-Type": "application/json", "Accept": "application/json"}
        if key.startswith("eyJ"):  # legacy JWT keys also go in Authorization
            self.headers["Authorization"] = f"Bearer {key}"
        self.urlopen = urlopen

    def _call(self, method: str, path: str, body: Any = None, prefer: str | None = None) -> Any:
        headers = dict(self.headers, **({"Prefer": prefer} if prefer else {}))
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self.urlopen(request, timeout=60) as response:
                text = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("message", "")
            except (ValueError, AttributeError):
                detail = ""
            raise RuntimeError(f"{method} {path.split('?')[0]}: HTTP {exc.code} {detail}") from None
        except urllib.error.URLError as exc:
            raise RuntimeError(f"{method} {path.split('?')[0]}: {exc.reason}") from None
        return json.loads(text) if text else None

    def select(self, table: str, columns: str, order: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        while True:
            page = self._call("GET", f"{table}?select={columns}&order={order}&limit={PAGE}&offset={len(rows)}")
            rows += page
            if len(page) < PAGE:
                return rows

    def insert(self, table: str, rows: list[dict[str, Any]], returning: str | None = None) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for i in range(0, len(rows), 500):
            chunk = rows[i : i + 500]
            if returning:
                out += self._call("POST", f"{table}?select={returning}", chunk, "return=representation")
            else:
                self._call("POST", table, chunk, "return=minimal")
        return out

    def update(self, table: str, match: dict[str, Any], values: dict[str, Any]) -> None:
        filters = "&".join(f"{k}=eq.{urllib.parse.quote(str(v))}" for k, v in match.items())
        self._call("PATCH", f"{table}?{filters}", values, "return=minimal")


# ------------------------------------------------------------------ the import


def _film_row(f: dict[str, Any], m: dict[str, Any], profile_ids: dict[str, str]) -> dict[str, Any]:
    has_tmdb = bool(m.get("tmdb_id"))
    return {
        "tmdb_id": m.get("tmdb_id"),
        "title": m["title"] if has_tmdb else f["title"],
        "original_title": m.get("original_title") if has_tmdb else None,
        "release_year": m.get("release_year"),
        "release_date": m.get("release_date") if has_tmdb else None,
        "poster_path": m.get("poster_path"),
        "backdrop_path": m.get("backdrop_path"),
        "overview": m.get("overview"),
        "runtime_min": m.get("runtime_min"),
        "genres": m.get("genres") or [],
        "directors": m.get("directors") or [],
        "source_url": f.get("source_url"),
        "screened_on": f["screened_on"],
        "kind": f["kind"],
        "assigned_id": profile_ids[f["assigned"]],
        "turn_holder_id": profile_ids[f["turn_holder"]] if f.get("turn_holder") else None,
        "day_order": f["day_order"],
        "is_easter_egg": f["is_easter_egg"],
        "legacy_sheet_row": f["legacy_sheet_row"],
        "tmdb_fetched_at": m.get("fetched_at"),
    }


def _name(name: str) -> str:
    return name.strip().lower()  # the DB's unique index: lower(btrim(display_name))


def run_import(
    data: dict[str, Any], matches: dict[str, dict[str, Any]], db: Any, dry_run: bool = False, log: Callable[[str], None] = print
) -> dict[str, int]:
    """Import everything; returns the number of rows written per step.
    ``db`` has ``select``, ``insert`` and ``update`` (see :class:`Rest`)."""
    check_ready(data, matches)
    written: Counter = Counter()

    # 1. Profiles: keep existing ones (e.g. made by create-admin), fill their empty keyword/colour.
    existing = {_name(p["display_name"]): p for p in db.select("profiles", "id,display_name,sheet_keyword,colour,is_system", "id")}
    new_profiles = []
    for p in data["profiles"]:
        have = existing.get(_name(p["display_name"]))
        if have is None:
            new_profiles.append({k: p[k] for k in ("display_name", "sheet_keyword", "colour", "role", "is_system")})
            continue
        if have["is_system"] != p["is_system"]:
            raise ImportRefused(f"profile {p['display_name']!r} exists with is_system={have['is_system']}")
        fill = {k: p[k] for k in ("sheet_keyword", "colour") if have[k] is None and p[k]}
        if fill:
            written["profiles updated"] += 1
            if not dry_run:
                db.update("profiles", {"id": have["id"]}, fill)
    written["profiles"] = len(new_profiles)
    if new_profiles and not dry_run:
        for row in db.insert("profiles", new_profiles, returning="id,display_name"):
            existing[_name(row["display_name"])] = row
    if dry_run:  # placeholder ids so the plan below can be counted
        for p in new_profiles:
            existing[_name(p["display_name"])] = {"id": "new:" + p["display_name"]}
    profile_ids = {p["display_name"]: existing[_name(p["display_name"])]["id"] for p in data["profiles"]}

    # 2. Films, matched on natural keys.
    have_films = db.select("films", "id,scores_locked," + ",".join(FILM_FIELDS), "id")
    by_tmdb = {f["tmdb_id"]: f for f in have_films if f["tmdb_id"]}
    by_title = {(title_norm(f["title"]), f["release_year"]): f for f in have_films if not f["tmdb_id"]}
    by_row = {(f["legacy_sheet_row"], f["screened_on"]): f for f in have_films if f["legacy_sheet_row"]}
    film_ids: dict[str, Any] = {}
    locked: set[str] = set()
    for f in data["films"]:
        row = _film_row(f, matches[f["legacy_key"]], profile_ids)
        have = (
            by_tmdb.get(row["tmdb_id"])
            or by_title.get((title_norm(row["title"]), row["release_year"]) if not row["tmdb_id"] else None)
            or by_row.get((row["legacy_sheet_row"], row["screened_on"]))
        )
        if have is None:
            written["films"] += 1
            film_ids[f["legacy_key"]] = "new:" + f["legacy_key"]
            if not dry_run:
                film_ids[f["legacy_key"]] = db.insert("films", [row], returning="id")[0]["id"]
            continue
        film_ids[f["legacy_key"]] = have["id"]
        if have["scores_locked"]:
            locked.add(f["legacy_key"])
        diff = {k: v for k, v in row.items() if k != "tmdb_fetched_at" and have.get(k) != v}
        if diff:
            written["films updated"] += 1
            if not dry_run:
                db.update("films", {"id": have["id"]}, diff)

    ids = set(film_ids.values())

    # 3. Attendance.
    have_att = {(a["film_id"], a["profile_id"]) for a in db.select("attendance", "film_id,profile_id", "film_id,profile_id")}
    new_att = [
        {"film_id": film_ids[a["film"]], "profile_id": profile_ids[a["profile"]]}
        for a in data["attendance"]
        if (film_ids[a["film"]], profile_ids[a["profile"]]) not in have_att
    ]
    written["attendance"] = len(new_att)
    if new_att and not dry_run:
        db.insert("attendance", new_att)

    # 4. Scores (before the lock; locked films' scores are never touched again).
    have_scores = {(s["film_id"], s["profile_id"]): s["score"] for s in db.select("scores", "film_id,profile_id,score", "film_id,profile_id")}
    new_scores = []
    for s in data["scores"]:
        key = (film_ids[s["film"]], profile_ids[s["profile"]])
        if key not in have_scores:
            new_scores.append({"film_id": key[0], "profile_id": key[1], "score": s["score"], "entered_by": profile_ids[s["entered_by"]]})
        elif Decimal(str(have_scores[key])) != Decimal(s["score"]) and s["film"] not in locked:
            written["scores updated"] += 1
            if not dry_run:
                db.update("scores", {"film_id": key[0], "profile_id": key[1]}, {"score": s["score"]})
    written["scores"] = len(new_scores)
    if new_scores and not dry_run:
        db.insert("scores", new_scores)

    # 5. Legacy comments (the same text on the same film counts as already there).
    have_comments = Counter(
        (c["film_id"], c["body"]) for c in db.select("comments", "film_id,body,is_legacy", "id") if c["is_legacy"]
    )
    new_comments = []
    for c in data["comments"]:
        key = (film_ids[c["film"]], c["body"])
        if have_comments[key] > 0:
            have_comments[key] -= 1
            continue
        new_comments.append(
            {"film_id": key[0], "author_id": profile_ids[c["author"]], "body": c["body"], "is_legacy": True, "created_at": c["created_at"]}
        )
    written["comments"] = len(new_comments)
    if new_comments and not dry_run:
        db.insert("comments", new_comments)

    # 6. Lock the easter egg, after its scores are in.
    for key in data["lock_after_scores"]:
        if key not in locked:
            written["locked"] += 1
            if not dry_run:
                db.update("films", {"id": film_ids[key]}, {"scores_locked": True})

    for step in ("profiles", "profiles updated", "films", "films updated", "attendance", "scores", "scores updated", "comments", "locked"):
        log(f"{'would write' if dry_run else 'wrote'} {step}: {written[step]}")
    if not dry_run:
        verify_counts(data, db, ids, profile_ids, log)
    return dict(written)


def verify_counts(
    data: dict[str, Any], db: Any, film_ids: set[Any], profile_ids: dict[str, Any], log: Callable[[str], None] = print
) -> dict[str, int]:
    """Count what the database now holds for the imported films and compare it
    with the preview's counts. Raises :class:`CountMismatch`."""
    films = [f for f in db.select("films", "id,scores_locked", "id") if f["id"] in film_ids]
    actual = {
        "profiles": len({p["id"] for p in db.select("profiles", "id", "id")} & set(profile_ids.values())),
        "films": len(films),
        "attendance": sum(1 for a in db.select("attendance", "film_id", "film_id,profile_id") if a["film_id"] in film_ids),
        "scores": sum(1 for s in db.select("scores", "film_id", "film_id,profile_id") if s["film_id"] in film_ids),
        "comments": sum(1 for c in db.select("comments", "film_id,is_legacy", "id") if c["is_legacy"] and c["film_id"] in film_ids),
        "locked": sum(1 for f in films if f["scores_locked"]),
    }
    c = data["counts"]
    expected = {
        "profiles": c["profiles"] + c["system_profiles"],
        "films": c["films"],
        "attendance": c["attendance"],
        "scores": c["scores"],
        "comments": c["comments"],
        "locked": len(data["lock_after_scores"]),
    }
    log("counts (database / preview):")
    for k in expected:
        log(f"  {k}: {actual[k]} / {expected[k]}{'' if actual[k] == expected[k] else '  <-- MISMATCH'}")
    bad = [k for k in expected if actual[k] != expected[k]]
    if bad:
        raise CountMismatch(f"the database doesn't match the preview for: {', '.join(bad)}")
    return actual
