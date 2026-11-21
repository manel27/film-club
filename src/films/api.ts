import { supabase } from '../lib/supabase'
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
    supabase.from('profile_directory').select('id, display_name, colour, is_system'),
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
    people: (people.data ?? []).map((p) => ({
      id: p.id!,
      name: p.display_name!,
      colour: p.colour,
      isSystem: p.is_system!,
    })),
    scored: new Set((scores.data ?? []).map((s) => s.film_id)),
  }
}
