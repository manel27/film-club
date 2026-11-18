"""Step 3: ``import.json`` -> ``preview.html`` + ``preview.md``.

The preview is what the owner reads before approving the import. All sheet
text is escaped; the HTML is a single self-contained file (no scripts, no
external resources) that renders in light and dark mode.
"""

from __future__ import annotations

import html
import re
from collections import Counter, defaultdict
from decimal import Decimal
from typing import Any

KIND_LABELS = {"normal": "Normal", "democratico": "Democrático", "cinema": "Cinema", "maratona": "Maratona"}
SANITY_LABELS = {
    "rows": ("sheet_rows", "Sheet rows (films incl. planned)"),
    "films": ("films", "Films to import"),
    "films_shown": ("films_shown", "Films already shown"),
    "films_planned": ("films_planned", "Planned films (future date)"),
    "score_cells": ("score_cells", "Score cells in the sheet"),
    "scores": ("scores", "Scores to import"),
    "present_cells": ("present_cells", "Present (coloured) cells in the sheet"),
    "attendance": ("attendance", "Attendance rows to import"),
    "notes": ("notes", "Notes in the sheet"),
    "comments": ("comments", "Legacy comments to import"),
    "links": ("links", "Linked titles"),
    "duplicates": ("duplicates", "Duplicate films"),
    "average_mismatches": ("average_mismatches", "Rows where the sheet's Média differs from the recomputed average"),
}
_SAFE_COLOUR = re.compile(r"^#[0-9a-f]{6}$")


def _e(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _colour(value: str | None) -> str:
    return value if value and _SAFE_COLOUR.match(value) else "#cccccc"


def _text_colour(bg: str) -> str:
    r, g, b = (int(bg[i : i + 2], 16) for i in (1, 3, 5))
    return "#111111" if (0.299 * r + 0.587 * g + 0.114 * b) > 150 else "#ffffff"


def _md(value: Any) -> str:
    """Sheet text for a Markdown table cell: raw HTML escaped (so a note
    can't inject markup), pipes and backslashes escaped, one line."""
    text = html.escape("" if value is None else str(value), quote=False)
    return text.replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def summarise(data: dict[str, Any]) -> dict[str, Any]:
    """Per-person totals and other derived figures used by both formats."""
    films = {f["legacy_key"]: f for f in data["films"]}
    totals: dict[str, Counter] = defaultdict(Counter)
    present_by_film: dict[str, set[str]] = defaultdict(set)
    for a in data["attendance"]:
        totals[a["profile"]]["present"] += 1
        present_by_film[a["film"]].add(a["profile"])
    for f in data["films"]:
        if f["assigned"]:
            totals[f["assigned"]]["chosen"] += 1
    score_sum: dict[str, Decimal] = defaultdict(Decimal)
    for s in data["scores"]:
        totals[s["profile"]]["scored"] += 1
        if s["profile"] not in present_by_film[s["film"]]:
            totals[s["profile"]]["scored_absent"] += 1
        if not films[s["film"]]["is_easter_egg"]:
            totals[s["profile"]]["scored_counted"] += 1
            score_sum[s["profile"]] += Decimal(s["score"])
    people = []
    for p in data["profiles"]:
        t = totals[p["display_name"]]
        avg = score_sum[p["display_name"]] / t["scored_counted"] if t["scored_counted"] else None
        people.append({**p, **{k: t[k] for k in ("chosen", "present", "scored", "scored_absent")}, "avg": avg})

    scores_by_film: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for s in data["scores"]:
        scores_by_film[s["film"]].append((s["profile"], s["score"]))
    comments_by_film: dict[str, list[str]] = defaultdict(list)
    for c in data["comments"]:
        comments_by_film[c["film"]].append(c["body"])

    sanity = []
    counts = data["counts"]
    expected = data.get("expected", {})
    notes = data.get("expected_notes", {})
    for key, (count_key, label) in SANITY_LABELS.items():
        actual = counts.get(count_key)
        exp = expected.get(key)
        sanity.append(
            {
                "key": key,
                "label": label,
                "actual": actual,
                "expected": exp,
                "ok": None if exp is None else exp == actual,
                "note": notes.get(key, ""),
            }
        )
    return {
        "people": people,
        "present_by_film": present_by_film,
        "scores_by_film": scores_by_film,
        "comments_by_film": comments_by_film,
        "sanity": sanity,
        "colours": {p["display_name"]: p["colour"] for p in data["profiles"]},
    }


def _group(entries: list[dict[str, Any]]) -> list[tuple[str, list[dict[str, Any]]]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in entries:
        groups[e["label"]].append(e)
    return sorted(groups.items(), key=lambda kv: -len(kv[1]))


# --------------------------------------------------------------------- HTML

_CSS = """
:root{--bg:#f7f7f5;--surface:#fff;--text:#1d1d1f;--muted:#6b6b70;--border:#e2e2e0;
--accent:#1f4fd1;--warn-bg:#fff4e0;--warn:#9a5b00;--ok:#1d7a3a;--bad:#b3261e;--chip:#f0f0ee}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--surface:#1d1d20;--text:#ececef;
--muted:#9a9aa2;--border:#2e2e33;--accent:#8fb0ff;--warn-bg:#3a2a10;--warn:#ffc46b;--ok:#6fd38f;
--bad:#ff8a80;--chip:#2a2a2f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px;
padding-bottom:6px;border-bottom:1px solid var(--border)}h3{font-size:16px;margin:24px 0 8px}
.muted{color:var(--muted)}nav a{margin-right:14px;color:var(--accent);text-decoration:none}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin:16px 0}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px}
.card b{display:block;font-size:24px}.wrap{overflow-x:auto;background:var(--surface);
border:1px solid var(--border);border-radius:10px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:7px 10px;
border-bottom:1px solid var(--border);vertical-align:top}th{font-size:12px;text-transform:uppercase;
letter-spacing:.04em;color:var(--muted);background:var(--surface);position:sticky;top:0}
tr:last-child td{border-bottom:0}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;
margin-right:6px;border:1px solid rgba(0,0,0,.2)}
.chip{display:inline-block;padding:1px 7px;border-radius:999px;font-size:12px;margin:1px 2px 1px 0;
white-space:nowrap}.chip.score{background:var(--chip);color:var(--text)}
.chip.score.absent{border:1px dashed var(--muted)}
.kind{font-size:12px;padding:1px 7px;border-radius:6px;background:var(--chip)}
.kind.democratico{background:#e8defc;color:#4b2a91}.kind.cinema{background:#dcf3e2;color:#17602f}
.kind.maratona{background:#fdecc8;color:#7a4d00}
.decide{background:var(--warn-bg);border:1px solid var(--warn);border-radius:10px;padding:12px 16px}
.decide h2{border:0;margin-top:0;color:var(--warn)}.ok{color:var(--ok)}.bad{color:var(--bad);font-weight:600}
.note{font-size:13px;color:var(--muted);margin-top:4px;white-space:pre-wrap}
.lock{font-weight:600;color:var(--bad)}details{margin:6px 0}summary{cursor:pointer}
@media (max-width:700px){th,td{padding:6px}}
"""


def _swatch(colour: str | None) -> str:
    return f'<span class="sw" style="background:{_colour(colour)}"></span>'


def _person(name: str | None, colours: dict[str, str]) -> str:
    if not name:
        return '<span class="bad">none</span>'
    return f"{_swatch(colours.get(name))}{_e(name)}"


def _chip(name: str, colours: dict[str, str]) -> str:
    bg = _colour(colours.get(name))
    return f'<span class="chip" style="background:{bg};color:{_text_colour(bg)}">{_e(name)}</span>'


def _entries_table(entries: list[dict[str, Any]], show_label: bool) -> str:
    rows = []
    for e in entries:
        label = f"<td>{_e(e['label'])}</td>" if show_label else ""
        rows.append(
            f"<tr>{label}<td class='num'>{_e(e.get('row', ''))}</td><td>{_e(e.get('date', ''))}</td>"
            f"<td>{_e(e.get('title', ''))}</td><td>{_e(e['detail'])}</td></tr>"
        )
    head = "<th>Issue</th>" if show_label else ""
    return (
        f"<div class='wrap'><table><thead><tr>{head}<th class='num'>Row</th><th>Date</th><th>Title</th>"
        f"<th>Detail</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>"
    )


def render_html(data: dict[str, Any]) -> str:
    s = summarise(data)
    colours = s["colours"]
    c = data["counts"]
    out: list[str] = []
    w = out.append
    w("<!doctype html><html lang='en'><head><meta charset='utf-8'>")
    w("<meta name='viewport' content='width=device-width,initial-scale=1'>")
    w("<title>Migration preview</title><style>" + _CSS + "</style></head><body><main>")
    w("<h1>Film Club: migration preview</h1>")
    w(
        f"<p class='muted'>Source {_e(data['source'].get('name'))} · sha256 "
        f"{_e(str(data['source'].get('sha256', ''))[:12])}… · <b>as of {_e(data['today'])}</b> "
        "(films after this date are planned). "
        "Nothing has been imported yet.</p>"
    )
    w(
        "<nav><a href='#decide'>Needs your decision</a><a href='#sanity'>Sanity counts</a>"
        "<a href='#people'>People</a><a href='#fixes'>Automatic fixes</a><a href='#films'>Films</a>"
        "<a href='#observations'>Observations</a></nav>"
    )
    w("<div class='cards'>")
    for label, value in (
        ("Films", c["films"]),
        ("Planned", c["films_planned"]),
        ("Scores", c["scores"]),
        ("Present", c["attendance"]),
        ("Comments", c["comments"]),
        ("People", c["profiles"]),
        ("Automatic fixes", c["fixes"]),
        ("Needs decision", c["needs_decision"]),
    ):
        w(f"<div class='card'><span class='muted'>{_e(label)}</span><b>{_e(value)}</b></div>")
    w("</div>")

    w("<section id='decide' class='decide'><h2>Needs your decision</h2>")
    if data["needs_decision"]:
        w(
            "<p>The import can't settle these on its own. Answer each one, and the answers go into "
            "<code>migration/overrides.yaml</code>.</p>"
        )
        w(_entries_table(data["needs_decision"], show_label=True))
    else:
        w("<p class='ok'>Nothing: every row was resolved by the rules and the overrides file.</p>")
    w("</section>")

    w("<h2 id='sanity'>Sanity counts</h2><div class='wrap'><table><thead><tr><th>Check</th>")
    w("<th class='num'>Actual</th><th class='num'>Expected</th><th>Status</th><th>Explanation</th></tr></thead><tbody>")
    for row in s["sanity"]:
        status = "" if row["ok"] is None else ("<span class='ok'>✓ match</span>" if row["ok"] else "<span class='bad'>differs</span>")
        w(
            f"<tr><td>{_e(row['label'])}</td><td class='num'>{_e(row['actual'])}</td>"
            f"<td class='num'>{_e(row['expected'] if row['expected'] is not None else '—')}</td>"
            f"<td>{status}</td><td>{_e(row['note'])}</td></tr>"
        )
    kinds = ", ".join(f"{KIND_LABELS[k]} {v}" for k, v in c["kinds"].items())
    w(f"<tr><td>Films by kind</td><td class='num' colspan='2'>{_e(kinds)}</td><td></td><td></td></tr>")
    w("</tbody></table></div>")

    w("<h2 id='people'>People</h2><div class='wrap'><table><thead><tr><th>Person</th><th>Keyword</th><th>Role</th>")
    w("<th class='num'>Chose</th><th class='num'>Present</th><th class='num'>Scored</th>")
    w("<th class='num'>Scored, not present</th><th class='num'>Avg given</th></tr></thead><tbody>")
    for p in s["people"]:
        system = " <span class='muted'>(system)</span>" if p["is_system"] else ""
        avg = f"{p['avg']:.2f}" if p["avg"] is not None else ""
        w(
            f"<tr><td>{_swatch(p['colour'])}{_e(p['display_name'])}{system}</td>"
            f"<td>{_e(', '.join(p['keywords']))}</td><td>{_e(p['role'])}</td>"
            f"<td class='num'>{p['chosen']}</td><td class='num'>{p['present']}</td>"
            f"<td class='num'>{p['scored']}</td><td class='num'>{p['scored_absent']}</td><td class='num'>{avg}</td></tr>"
        )
    w("</tbody></table></div>")
    w("<p class='muted'>Chose counts every film assigned to the person, including untagged Maratona films "
      "given to the default person and assignments set in the overrides file. Averages leave out the "
      "easter-egg film. A score without a coloured cell means scored but not marked present (common in "
      "2021–22).</p>")

    w(f"<h2 id='fixes'>Automatic fixes ({len(data['fixes'])})</h2>")
    for label, entries in _group(data["fixes"]):
        w(f"<details><summary><b>{_e(label)}</b> — {len(entries)}</summary>")
        w(_entries_table(entries, show_label=False))
        w("</details>")
    if data["overrides_applied"]:
        w(f"<h3>Overrides applied from the overrides file ({len(data['overrides_applied'])})</h3>")
        w("<div class='wrap'><table><thead><tr><th class='num'>Row</th><th>Date</th><th>Title</th><th>Set</th><th>Reason</th></tr></thead><tbody>")
        for o in data["overrides_applied"]:
            sets = ", ".join(f"{k} = {v}" for k, v in o["set"].items())
            w(
                f"<tr><td class='num'>{_e(o['row'])}</td><td>{_e(o['date'])}</td><td>{_e(o['title'])}</td>"
                f"<td>{_e(sets)}</td><td>{_e(o['reason'])}</td></tr>"
            )
        w("</tbody></table></div>")

    w(f"<h2 id='films'>Films ({len(data['films'])})</h2>")
    w("<p class='muted'>Newest first. Chips: present people in their colour. Scores: a dashed outline means "
      "scored but not present.</p>")
    by_year: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in reversed(data["films"]):
        by_year[f["screened_on"][:4]].append(f)
    for year, films in by_year.items():
        w(f"<h3>{_e(year)} · {len(films)} films</h3><div class='wrap'><table><thead><tr><th class='num'>Row</th>")
        w("<th>Date</th><th>Title</th><th>Kind</th><th>Assigned</th><th>Present</th><th>Scores</th></tr></thead><tbody>")
        for f in films:
            ref = f["legacy_sheet_row"]
            key = f["legacy_key"]
            present = s["present_by_film"].get(key, set())
            title = _e(f["title"])
            url = f.get("source_url") or ""
            if url.startswith(("https://", "http://")):
                title = f"<a href='{_e(url)}' rel='noreferrer noopener'>{title}</a>"
            extra = []
            if f["year_hint"]:
                extra.append(f"<span class='muted'>({_e(f['year_hint'])})</span>")
            if f["labels"]:
                extra.append(f"<span class='muted'>[{_e(', '.join(f['labels']))}]</span>")
            if f["is_planned"]:
                extra.append("<span class='kind'>planned</span>")
            if f["is_easter_egg"]:
                extra.append("<span class='lock'>🔒 easter egg, scores locked</span>")
            notes = "".join(f"<div class='note'>💬 {_e(b)}</div>" for b in s["comments_by_film"].get(key, []))
            chips = "".join(_chip(n, colours) for n in sorted(present)) or "<span class='muted'>—</span>"
            score_chips = "".join(
                f"<span class='chip score{'' if n in present else ' absent'}'>{_swatch(colours.get(n))}"
                f"{_e(n)} <b>{_e(v)}</b></span>"
                for n, v in s["scores_by_film"].get(key, [])
            ) or "<span class='muted'>—</span>"
            day = f" #{f['day_order']}" if f["day_order"] and f["day_order"] > 1 else ""
            w(
                f"<tr><td class='num'>{_e(ref)}</td><td>{_e(f['screened_on'])}{_e(day)}</td>"
                f"<td>{title} {' '.join(extra)}{notes}</td>"
                f"<td><span class='kind {_e(f['kind'])}'>{_e(KIND_LABELS[f['kind']])}</span></td>"
                f"<td>{_person(f['assigned'], colours)}</td><td>{chips}</td><td>{score_chips}</td></tr>"
            )
        w("</tbody></table></div>")

    w(f"<h2 id='observations'>Observations ({len(data['observations'])})</h2>")
    w("<p class='muted'>For information only; nothing to decide unless something looks wrong.</p>")
    for label, entries in _group(data["observations"]):
        w(f"<details><summary><b>{_e(label)}</b> — {len(entries)}</summary>")
        w(_entries_table(entries, show_label=False))
        w("</details>")
    w("<p class='muted'>TMDB matching (posters, confidence) comes in the import phase; each film already "
      "carries its search query and year hint.</p>")
    w("</main></body></html>")
    return "\n".join(out)


# ----------------------------------------------------------------- Markdown


def _md_entries(entries: list[dict[str, Any]], show_label: bool) -> list[str]:
    head = "| Issue | Row | Date | Title | Detail |" if show_label else "| Row | Date | Title | Detail |"
    lines = [head, "|" + "---|" * (5 if show_label else 4)]
    for e in entries:
        cells = [e.get("row", ""), e.get("date", ""), e.get("title", ""), e["detail"]]
        if show_label:
            cells.insert(0, e["label"])
        lines.append("| " + " | ".join(_md(x) for x in cells) + " |")
    return lines


def render_markdown(data: dict[str, Any]) -> str:
    s = summarise(data)
    c = data["counts"]
    L: list[str] = []
    L += ["# Film Club: migration preview", ""]
    L += [
        f"Source `{_md(data['source'].get('name'))}` (sha256 `{str(data['source'].get('sha256', ''))[:12]}…`). "
        f"**As of {_md(data['today'])}** (films after this date are planned). Nothing has been imported yet.",
        "",
    ]
    L += [
        f"**{c['films']} films** ({c['films_planned']} planned) · {c['scores']} scores · {c['attendance']} present · "
        f"{c['comments']} comments · {c['profiles']} people · {c['fixes']} automatic fixes · "
        f"**{c['needs_decision']} need a decision**",
        "",
    ]
    L += ["## Needs your decision", ""]
    if data["needs_decision"]:
        L += _md_entries(data["needs_decision"], show_label=True)
    else:
        L += ["Nothing: every row was resolved by the rules and the overrides file."]
    L += ["", "## Sanity counts", "", "| Check | Actual | Expected | Status | Explanation |", "|---|---|---|---|---|"]
    for row in s["sanity"]:
        status = "" if row["ok"] is None else ("match" if row["ok"] else "**differs**")
        exp = row["expected"] if row["expected"] is not None else "—"
        L.append(f"| {_md(row['label'])} | {_md(row['actual'])} | {_md(exp)} | {status} | {_md(row['note'])} |")
    kinds = ", ".join(f"{KIND_LABELS[k]} {v}" for k, v in c["kinds"].items())
    L += [f"| Films by kind | {kinds} | | | |", ""]

    L += ["## People", "", "| Person | Colour | Keywords | Role | Chose | Present | Scored | Scored, not present | Avg given |"]
    L += ["|---|---|---|---|---|---|---|---|---|"]
    for p in s["people"]:
        name = p["display_name"] + (" (system)" if p["is_system"] else "")
        avg = f"{p['avg']:.2f}" if p["avg"] is not None else ""
        L.append(
            f"| {_md(name)} | `{p['colour']}` | {_md(', '.join(p['keywords']))} | {p['role']} | {p['chosen']} | "
            f"{p['present']} | {p['scored']} | {p['scored_absent']} | {avg} |"
        )
    L += [""]

    L += [f"## Automatic fixes ({len(data['fixes'])})", ""]
    for label, entries in _group(data["fixes"]):
        L += [f"### {label} ({len(entries)})", ""] + _md_entries(entries, show_label=False) + [""]
    if data["overrides_applied"]:
        L += ["### Overrides applied", "", "| Row | Date | Title | Set | Reason |", "|---|---|---|---|---|"]
        for o in data["overrides_applied"]:
            sets = ", ".join(f"{k} = {v}" for k, v in o["set"].items())
            L.append(f"| {_md(o['row'])} | {_md(o['date'])} | {_md(o['title'])} | {_md(sets)} | {_md(o['reason'])} |")
        L += [""]

    L += [f"## Films ({len(data['films'])})", "", "Newest first. Scores marked `*` were given without being present.", ""]
    L += ["| Row | Date | Title | Kind | Assigned | Present | Scores | Notes |", "|---|---|---|---|---|---|---|---|"]
    for f in reversed(data["films"]):
        ref = f["legacy_sheet_row"]
        key = f["legacy_key"]
        present = s["present_by_film"].get(key, set())
        title = f["title"] + (f" ({f['year_hint']})" if f["year_hint"] else "")
        if f["labels"]:
            title += f" [{', '.join(f['labels'])}]"
        if f["is_planned"]:
            title += " — planned"
        if f["is_easter_egg"]:
            title += " — easter egg, scores locked"
        scores = ", ".join(f"{n} {v}{'' if n in present else '*'}" for n, v in s["scores_by_film"].get(key, []))
        notes = " / ".join(s["comments_by_film"].get(key, []))
        L.append(
            f"| {ref} | {_md(f['screened_on'])} | {_md(title)} | {KIND_LABELS[f['kind']]} | {_md(f['assigned'])} | "
            f"{_md(', '.join(sorted(present)))} | {_md(scores)} | {_md(notes)} |"
        )
    L += ["", f"## Observations ({len(data['observations'])})", ""]
    for label, entries in _group(data["observations"]):
        L += [f"### {label} ({len(entries)})", ""] + _md_entries(entries, show_label=False) + [""]
    return "\n".join(L) + "\n"
