import type { ExportData } from '../admin/export'
import { check, invoke } from '../films/api'
import type { Person } from '../films/films'
import { supabase } from '../lib/supabase'
import type { OpenLink } from './links'

export interface InvitePreview {
  name: string
  colour: string
  watched: number
}

/** Who an open link is for (a reset link with kind 'reset'); a dead link throws a 404. */
export const previewInvite = (token: string, kind: OpenLink['kind'] = 'invite') =>
  invoke<InvitePreview>('invite-preview', { token, kind })

/** Creates the login for the invite's person (then sign in with the same email and password). */
export const claimInvite = (token: string, email: string, password: string) =>
  invoke<{ ok: true }>('invite-claim', { token, email, password })

/** Sets the reset link's person's new password. Resolves with their email, for signing in. */
export const claimReset = (token: string, password: string) =>
  invoke<{ email: string }>('reset-claim', { token, password }).then((d) => d.email)

/** Admin: a new invite or reset link for the person (revokes their open one). Shown once. */
export const createLink = (kind: OpenLink['kind'], profileId: string) =>
  invoke<{ link: string; expires_at: string }>(
    kind === 'invite' ? 'invite-create' : 'admin-reset-link',
    { profile_id: profileId },
  )

/** Admin: revokes a link (RLS + invites_guard: admins may only revoke, at the server's time). */
export const revokeLink = (id: string) =>
  check(
    supabase
      .from('invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .select('id'),
    true,
  )

export interface AdminPerson extends Person {
  isClaimed: boolean
}

/** Admin: everyone but the system profiles, and every open (unused, unrevoked) link. */
export async function fetchAdminPeople(): Promise<{ people: AdminPerson[]; links: OpenLink[] }> {
  const [people, links] = await Promise.all([
    supabase
      .from('profile_directory')
      .select('id, display_name, colour, role, is_claimed, is_system')
      .eq('is_system', false),
    supabase
      .from('invites')
      .select('id, profile_id, kind, expires_at')
      .is('used_at', null)
      .is('revoked_at', null),
  ])
  const error = people.error ?? links.error
  if (error) throw error
  return {
    people: (people.data ?? [])
      .map((p) => ({
        id: p.id!,
        name: p.display_name!,
        colour: p.colour,
        isSystem: false,
        role: p.role ?? undefined,
        isClaimed: p.is_claimed!,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    links: (links.data ?? []).map((l) => ({
      id: l.id,
      profileId: l.profile_id,
      kind: l.kind as OpenLink['kind'],
      expiresAt: l.expires_at,
    })),
  }
}

/** Admin: a new, unclaimed person (RLS: admins only). */
export const addPerson = (displayName: string, colour: string, role: NonNullable<Person['role']>) =>
  check(supabase.from('profiles').insert({ display_name: displayName, colour, role }))

/** Admin: someone's name, colour and role (profiles_guard: not your own role; one admin stays). */
export const updatePerson = (
  id: string,
  fields: { display_name: string; colour: string | null; role: NonNullable<Person['role']> },
) => check(supabase.from('profiles').update(fields).eq('id', id).select('id'), true)

/** Admin: the whole export, as one value (so PostgREST's 1,000-row limit never cuts it). */
export async function fetchExport(): Promise<ExportData> {
  const { data, error } = await supabase.rpc('export_data')
  if (error) throw error
  return data as unknown as ExportData
}

/** When the last "Export all data" download happened (app_settings.last_export_at), or null. */
export async function fetchLastExport(): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'last_export_at')
    .maybeSingle()
  if (error) throw error
  return typeof data?.value === 'string' ? data.value : null
}

/** Admin: records an export (RLS: admins only), for the 30-day reminder. */
export const saveLastExport = (at: string) =>
  check(supabase.from('app_settings').upsert({ key: 'last_export_at', value: at }))

/** Admin: deletes the person's login; their profile and history stay (decision A2). */
export const removeLogin = (profileId: string) =>
  invoke<{ ok: true }>('admin-remove-login', { profile_id: profileId })
