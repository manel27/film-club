-- Deleting a film is admin-only (moderators may be allowed later).
-- Attendance, scores and comments are deleted with the film (on delete
-- cascade). The locked easter-egg film still can't be deleted by anyone
-- (films_guard), and its scores can't be deleted either (scores_guard).

drop policy films_delete_staff on public.films;

create policy films_delete_admin on public.films
  for delete to authenticated
  using ((select app.is_admin()));
