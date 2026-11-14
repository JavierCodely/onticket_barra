import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// La clave publicable es segura en el navegador; la secreta nunca va aca.
export const supabaseConfigured = Boolean(url && publishableKey)

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url, publishableKey)
  : null
