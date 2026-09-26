import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Null until a Supabase project is configured; requests then fail with a
// configuration error. Vite reads these values only when the dev server starts.
// PKCE: the Google redirect comes back with ?code=, which the client exchanges
// for a session on load.
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey, { auth: { flowType: "pkce" } }) : null;
