import { createClient } from '@supabase/supabase-js'
import { readSupabaseEnv } from './supabaseEnv'

const { url, publishableKey } = readSupabaseEnv(import.meta.env)

export const supabase = createClient(url, publishableKey)
