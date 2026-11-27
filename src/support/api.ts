import { check, fetchPeopleList } from '../films/api'
import type { Person } from '../films/films'
import { supabase } from '../lib/supabase'

// RLS decides what each person sees: their own suggestions, or every one for staff.

/**
 * The suggestions this person can see, newest first, with their reply counts.
 * shortcut: assumes fewer than 1,000 suggestions (PostgREST max_rows); page the query past that.
 */
async function querySuggestions() {
  const { data, error } = await supabase
    .from('suggestions')
    .select('id, author_id, title, created_at, suggestion_replies(count)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error
  return data.map((s) => ({
    id: s.id,
    author_id: s.author_id,
    title: s.title,
    created_at: s.created_at,
    replies: s.suggestion_replies[0]?.count ?? 0,
  }))
}

export type SuggestionSummary = Awaited<ReturnType<typeof querySuggestions>>[number]

export async function fetchSuggestions(): Promise<{
  suggestions: SuggestionSummary[]
  people: Person[]
}> {
  const [suggestions, people] = await Promise.all([querySuggestions(), fetchPeopleList()])
  return { suggestions, people }
}

function querySuggestion(id: number) {
  return supabase
    .from('suggestions')
    .select(
      'id, author_id, title, body, created_at, suggestion_replies(id, author_id, body, created_at)',
    )
    .eq('id', id)
    .order('created_at', { referencedTable: 'suggestion_replies' })
    .order('id', { referencedTable: 'suggestion_replies' })
    .maybeSingle()
}

export type Suggestion = NonNullable<Awaited<ReturnType<typeof querySuggestion>>['data']>

/** One suggestion and its thread; null when there is none or it isn't yours to see. */
export async function fetchSuggestion(
  id: number,
): Promise<{ suggestion: Suggestion; people: Person[] } | null> {
  const [suggestion, people] = await Promise.all([querySuggestion(id), fetchPeopleList()])
  if (suggestion.error) throw suggestion.error
  return suggestion.data ? { suggestion: suggestion.data, people } : null
}

// The author is set by the database (column default; RLS refuses anyone else).
export const supportWrites = {
  /** Returns the new suggestion's id. */
  addSuggestion: async (title: string, body: string): Promise<number> => {
    const { data, error } = await supabase
      .from('suggestions')
      .insert({ title, body })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  },
  addReply: (suggestion_id: number, body: string) =>
    check(supabase.from('suggestion_replies').insert({ suggestion_id, body })),
  // Its replies go with it (on delete cascade).
  deleteSuggestion: (id: number) =>
    check(supabase.from('suggestions').delete().eq('id', id).select('id'), true),
}
