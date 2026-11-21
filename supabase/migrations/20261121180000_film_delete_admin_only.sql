-- Deleting a film is admin-only (moderators may be allowed later).
-- Attendance, scores and comments are deleted with the film (on delete
-- cascade). The locked easter-egg film still can't be deleted by anyone
-- (films_guard), and its scores can't be deleted either (scores_guard).

drop policy films_delete_staff on public.films;

create policy films_delete_admin on public.films
  for delete to authenticated
  using ((select app.is_admin()));

-- ---------------------------------------------------------------------------
-- From the browser, one film per statement: a single request such as
-- DELETE films?id=neq.7 must not wipe the whole list. The import (secret
-- key) and postgres are not limited (app.is_privileged()).
-- SECURITY INVOKER on purpose (app.is_privileged()).
-- ---------------------------------------------------------------------------

create function app.films_delete_one_at_a_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.is_privileged() and (select count(*) from deleted_films) > 1 then
    raise exception 'Films can only be deleted one at a time'
      using errcode = '42501';
  end if;
  return null;
end;
$$;

create trigger films_delete_one_at_a_time
  after delete on public.films
  referencing old table as deleted_films
  for each statement execute function app.films_delete_one_at_a_time();

revoke execute on function app.films_delete_one_at_a_time() from public;
grant execute on function app.films_delete_one_at_a_time() to authenticated, service_role;
