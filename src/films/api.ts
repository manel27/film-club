import { supabase } from '../lib/supabase'
import { NO_ROWS } from './filmDetail'
import type { FilmSaveBody, FunctionError, TmdbResult } from './filmForm'
import type { FilmItem, Person } from './films'

export interface FilmsData {
  films: FilmItem[]
  people: Person[]
  /** Films the given profile has scored. */
  scored: Set<number>
}

/**
 * Everything the films page needs in four queries. Attendance is embedded in
 * the films query (PostgREST's max_rows limits top-level rows only), averages
 * come from film_stats, which already leaves out the easter egg's locked 11s.
 * shortcut: assumes fewer than 1,000 films (PostgREST max_rows); page the films query past that.
 */
export async function fetchFilmsData(profileId: string): Promise<FilmsData> {
  const [films, stats, people, scores] = await Promise.all([
    supabase
      .from('films')
      .select(
        'id, title, release_year, poster_path, genres, screened_on, day_order, kind, assigned_id, attendance(profile_id)',
      ),
    supabase.from('film_stats').select('film_id, avg_score'),
    fetchPeople(),
    supabase.from('scores').select('film_id').eq('profile_id', profileId),
  ])
  const error = films.error ?? stats.error ?? people.error ?? scores.error
  if (error) throw error

  const avg = new Map((stats.data ?? []).map((s) => [s.film_id, s.avg_score]))
  return {
    films: (films.data ?? []).map((f) => ({
      id: f.id,
      title: f.title,
      releaseYear: f.release_year,
      posterPath: f.poster_path,
      genres: f.genres,
      screenedOn: f.screened_on,
      dayOrder: f.day_order,
      kind: f.kind,
      assignedId: f.assigned_id,
      presentIds: f.attendance.map((a) => a.profile_id),
      avgScore: avg.get(f.id) ?? null,
    })),
    people: toPeople(people.data),
    scored: new Set((scores.data ?? []).map((s) => s.film_id)),
  }
}

function fetchPeople() {
  return supabase.from('profile_directory').select('id, display_name, colour, is_system, role')
}

function toPeople(rows: Awaited<ReturnType<typeof fetchPeople>>['data']): Person[] {
  return (rows ?? []).map((p) => ({
    id: p.id!,
    name: p.display_name!,
    colour: p.colour,
    isSystem: p.is_system!,
    role: p.role ?? undefined,
  }))
}

function queryFilm(id: number) {
  return supabase
    .from('films')
    .select(
      'id, tmdb_id, title, original_title, release_year, poster_path, directors, genres, runtime_min, overview, screened_on, kind, assigned_id, turn_holder_id, is_easter_egg, scores_locked, attendance(profile_id), scores(profile_id, score), comments(id, author_id, body, created_at, edited_at, is_legacy)',
    )
    .eq('id', id)
    .order('created_at', { referencedTable: 'comments' })
    .maybeSingle()
}

export type FilmRecord = NonNullable<Awaited<ReturnType<typeof queryFilm>>['data']>

export interface FilmDetailData {
  film: FilmRecord
  /** From film_stats: null for the easter egg, whose scores count nowhere else. */
  avgScore: number | null
  people: Person[]
}

/**
 * One film with its attendance, scores and comments; null if there is no such
 * film. Pass the people already loaded to skip fetching them again.
 */
export async function fetchFilm(id: number, known?: Person[]): Promise<FilmDetailData | null> {
  const [film, stats, people] = await Promise.all([
    queryFilm(id),
    supabase.from('film_stats').select('avg_score').eq('film_id', id).maybeSingle(),
    known ??
      fetchPeople().then(({ data, error }) => {
        if (error) throw error
        return toPeople(data)
      }),
  ])
  const error = film.error ?? stats.error
  if (error) throw error
  if (!film.data) return null
  return { film: film.data, avgScore: stats.data?.avg_score ?? null, people }
}

async function check(request: PromiseLike<{ error: unknown; data?: unknown }>, needsRow = false) {
  const { error, data } = await request
  if (error) throw error
  if (needsRow && !(data as unknown[] | null)?.length) throw NO_ROWS
}

// Writes. RLS and the DB triggers decide what each role may really do.
export const filmWrites = {
  setPresent: (film_id: number, profile_id: string, present: boolean) =>
    present
      ? check(supabase.from('attendance').insert({ film_id, profile_id }))
      : check(
          supabase.from('attendance').delete().match({ film_id, profile_id }).select('film_id'),
          true,
        ),
  saveScore: (film_id: number, profile_id: string, score: number) =>
    check(supabase.from('scores').upsert({ film_id, profile_id, score })),
  deleteScore: (film_id: number, profile_id: string) =>
    check(supabase.from('scores').delete().match({ film_id, profile_id }).select('film_id'), true),
  addComment: (film_id: number, author_id: string, body: string) =>
    check(supabase.from('comments').insert({ film_id, author_id, body })),
  editComment: (id: number, body: string) =>
    check(supabase.from('comments').update({ body }).eq('id', id).select('id'), true),
  deleteComment: (id: number) =>
    check(supabase.from('comments').delete().eq('id', id).select('id'), true),
  // Attendance, scores and comments go with it (on delete cascade).
  deleteFilm: (id: number) =>
    check(supabase.from('films').delete().eq('id', id).select('id'), true),
}

export interface ProfileData extends FilmsData {
  /** The person's scores by film id. */
  scores: Map<number, number>
  /** Film ids of the person's comments (one per comment). */
  commentFilmIds: number[]
  /** The easter egg's id(s): left out of every profile stat (plan 4.4). */
  easterEggIds: Set<number>
}

/** Everything a profile page needs: the films data plus the person's scores and comments. */
export async function fetchProfileData(personId: string): Promise<ProfileData> {
  const [base, scores, comments, eggs] = await Promise.all([
    fetchFilmsData(personId),
    supabase.from('scores').select('film_id, score').eq('profile_id', personId),
    supabase.from('comments').select('film_id').eq('author_id', personId),
    supabase.from('films').select('id').eq('is_easter_egg', true),
  ])
  const error = scores.error ?? comments.error ?? eggs.error
  if (error) throw error
  return {
    ...base,
    scores: new Map((scores.data ?? []).map((s) => [s.film_id, s.score])),
    commentFilmIds: (comments.data ?? []).map((c) => c.film_id),
    easterEggIds: new Set((eggs.data ?? []).map((f) => f.id)),
  }
}

/** Renames a profile (RLS: your own only; the trigger guards every other column). */
export const renameProfile = (id: string, displayName: string) =>
  check(
    supabase.from('profiles').update({ display_name: displayName }).eq('id', id).select('id'),
    true,
  )

/** Everyone, for the add/edit film form's choosers. */
export async function fetchPeopleList(): Promise<Person[]> {
  const { data, error } = await fetchPeople()
  if (error) throw error
  return toPeople(data)
}

/** Calls an Edge Function with the session's JWT; a refusal throws a FunctionError. */
async function invoke<T>(name: string, body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (!error) return data as T
  // FunctionsHttpError carries the Response; a network failure has none (status 0).
  const res = (error as { context?: unknown }).context
  const payload = res instanceof Response ? await res.json().catch(() => ({})) : {}
  throw { ...payload, status: res instanceof Response ? res.status : 0 } satisfies FunctionError
}

export const searchTmdb = (query: string) =>
  invoke<{ results: TmdbResult[] }>('tmdb-search', { query }).then((d) => d.results)

/** Adds or edits a film (film-save). Resolves with its id. */
export const saveFilm = (body: FilmSaveBody) =>
  invoke<{ id: number }>('film-save', body).then((d) => d.id)

/** Films this one would duplicate (the same check the database makes). */
export async function findDuplicates(film: {
  title: string
  year: number | null
  tmdbId: number | null
  originalTitle: string | null
}) {
  const { data, error } = await supabase.rpc('film_duplicate_check', {
    p_title: film.title,
    p_release_year: film.year ?? undefined,
    p_tmdb_id: film.tmdbId ?? undefined,
    p_original_title: film.originalTitle ?? undefined,
  })
  if (error) throw error
  return data
}
