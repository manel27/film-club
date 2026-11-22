import { fetchPeopleList } from '../films/api'
import { NO_ROWS } from '../films/filmDetail'
import type { FilmKind, Person } from '../films/films'
import { supabase } from '../lib/supabase'
import type { Standing } from './rotation'

export interface RotationData {
  /** Go-live date; null = rotation not started (no rotation_epoch). */
  epoch: string | null
  /** The week "who's next" is for; null when there are no standings yet. */
  weekStart: string | null
  /** From the rotation_standings view (the SQL mirror of computeStandings). */
  standings: Standing[]
  passes: { weekStart: string; profileId: string; createdBy: string | null }[]
  decisions: { weekStart: string; profileId: string; decidedBy: string | null }[]
  adjustments: {
    id: number
    profileId: string
    delta: number | null
    setTo: number | null
    clearOwedTurn: boolean
    reason: string | null
    effectiveAt: string
    createdBy: string | null
  }[]
  /** All normal and Democrático films (planned ones too), newest first. */
  chosen: {
    id: number
    title: string
    screenedOn: string
    kind: FilmKind
    assignedId: string
    turnHolderId: string | null
  }[]
  people: Person[]
}

async function rows<T>(request: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await request
  if (error) throw error
  return data as T
}

/** The rotation_epoch setting (YYYY-MM-DD), or null before go-live. */
export async function fetchEpoch(): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'rotation_epoch')
    .maybeSingle()
  if (error) throw error
  return typeof data?.value === 'string' ? data.value : null
}

/**
 * Everything the rotation page and the films page's "Next up" card need.
 * shortcut: assumes fewer than 1,000 rows per table (PostgREST max_rows); page past that.
 */
export async function fetchRotation(knownPeople?: Person[]): Promise<RotationData> {
  const [epoch, standings, passes, decisions, adjustments, people, chosen] = await Promise.all([
    fetchEpoch(),
    rows(supabase.from('rotation_standings').select('*')),
    rows(
      supabase
        .from('rotation_passes')
        .select('week_start, profile_id, created_by')
        .order('week_start', { ascending: false }),
    ),
    rows(supabase.from('rotation_next').select('week_start, profile_id, decided_by')),
    rows(
      supabase
        .from('rotation_adjustments')
        .select('id, profile_id, delta, set_to, clear_owed_turn, reason, effective_at, created_by')
        .order('effective_at', { ascending: false })
        .order('id', { ascending: false }),
    ),
    knownPeople ?? fetchPeopleList(),
    // Every counted film: the epoch isn't known yet, and there are only a few hundred.
    rows(
      supabase
        .from('films')
        .select('id, title, screened_on, kind, assigned_id, turn_holder_id')
        .in('kind', ['normal', 'democratico'])
        .order('screened_on', { ascending: false })
        .order('day_order', { ascending: false }),
    ),
  ])
  return {
    epoch,
    weekStart: standings[0]?.week_start ?? null,
    standings: standings.map((s) => ({
      profileId: s.profile_id!,
      points: s.points!,
      owedRank: s.owed_rank,
      owedSince: s.owed_since,
    })),
    passes: passes.map((p) => ({
      weekStart: p.week_start,
      profileId: p.profile_id,
      createdBy: p.created_by,
    })),
    decisions: decisions.map((d) => ({
      weekStart: d.week_start,
      profileId: d.profile_id,
      decidedBy: d.decided_by,
    })),
    adjustments: adjustments.map((a) => ({
      id: a.id,
      profileId: a.profile_id,
      delta: a.delta,
      setTo: a.set_to,
      clearOwedTurn: a.clear_owed_turn,
      reason: a.reason,
      effectiveAt: a.effective_at,
      createdBy: a.created_by,
    })),
    chosen: chosen.map((f) => ({
      id: f.id,
      title: f.title,
      screenedOn: f.screened_on,
      kind: f.kind,
      assignedId: f.assigned_id,
      turnHolderId: f.turn_holder_id,
    })),
    people,
  }
}

async function check(request: PromiseLike<{ error: unknown }>) {
  const { error } = await request
  if (error) throw error
}

// RLS filters a refused delete silently: no row back = not removed.
async function deleted(request: PromiseLike<{ error: unknown; data: unknown[] | null }>) {
  const { error, data } = await request
  if (error) throw error
  if (!data?.length) throw NO_ROWS
}

// Writes. RLS decides who may do what (plan 5); the triggers record who did it.
export const rotationWrites = {
  pass: (week_start: string, profile_id: string) =>
    check(supabase.from('rotation_passes').insert({ week_start, profile_id })),
  unpass: (week_start: string, profile_id: string) =>
    deleted(
      supabase
        .from('rotation_passes')
        .delete()
        .match({ week_start, profile_id })
        .select('week_start'),
    ),
  decide: (week_start: string, profile_id: string) =>
    check(supabase.from('rotation_next').upsert({ week_start, profile_id })),
  /** Back to the computed "who's next". */
  undecide: (week_start: string) =>
    deleted(
      supabase.from('rotation_next').delete().eq('week_start', week_start).select('week_start'),
    ),
  /** Admin only (R3). The database refuses anything but a real YYYY-MM-DD date. */
  setEpoch: (date: string) =>
    check(supabase.from('app_settings').upsert({ key: 'rotation_epoch', value: date })),
  adjust: (a: {
    profile_id: string
    delta?: number
    set_to?: number
    clear_owed_turn?: boolean
    reason: string
    /** YYYY-MM-DD: applies from the start of that day (Lisbon). */
    effective_on: string
  }) => {
    const { effective_on, ...row } = a
    // Lisbon midnight is 00:00 or 01:00 UTC; either way the same Lisbon date.
    return check(
      supabase
        .from('rotation_adjustments')
        .insert({ ...row, effective_at: `${effective_on}T00:00:00Z` }),
    )
  },
}
