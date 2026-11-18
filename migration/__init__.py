"""Film Club sheet migration: parse the Google Sheets HTML export, interpret it
into the platform's data model and write a preview report.

The sheet export is untrusted data. It is only ever read as text; nothing in it
is executed. Run everything with ``python3 -I``.
"""

__all__ = ["parse_sheet", "interpret", "preview", "config", "dupes", "tmdb"]
