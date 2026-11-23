import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { readSupabaseEnv } from './supabaseEnv'

const { url, publishableKey } = readSupabaseEnv(import.meta.env)

// No OAuth or magic links: never take a session from the URL (login CSRF).
export const supabase = createClient<Database>(url, publishableKey, {
  auth: { detectSessionInUrl: false },
})
