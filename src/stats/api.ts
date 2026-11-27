import { supabase } from '../lib/supabase'

/** stats_data()'s raw jsonb (one call: no PostgREST row limit); parseStatsData reads it. */
export async function fetchStatsData(): Promise<unknown> {
  const { data, error } = await supabase.rpc('stats_data')
  if (error) throw error
  return data
}
