#!/bin/sh
# Writes supabase/functions/.env for the e2e tests (fake TMDB, placeholder token).
# CI runs this same script. Never overwrites an existing file (it may hold your own token).
f=supabase/functions/.env
if [ -e "$f" ]; then
  echo "$f exists, not overwriting" >&2
  exit 1
fi
printf 'TMDB_TOKEN=%s\nTMDB_BASE_URL=%s\n' placeholder-not-a-real-token http://host.docker.internal:54399 > "$f"
