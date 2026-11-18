import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { readSupabaseEnv } from './supabaseEnv'

const { url, publishableKey } = readSupabaseEnv(import.meta.env)

export const supabase = createClient<Database>(url, publishableKey)
