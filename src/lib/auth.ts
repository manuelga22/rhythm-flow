import { supabase } from "@/lib/supabase";

export type Profile = {
  id: string;
  display_name: string | null;
};

export const MAX_DISPLAY_NAME = 50;

export const profileKey = (id: string) => ["profile", id] as const;

function client() {
  if (!supabase) throw new Error("Accounts aren't available right now.");
  return supabase;
}

/** Email a 6-digit sign-in code, creating the account on first use. */
export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}

export async function verifyEmailCode(email: string, token: string): Promise<void> {
  const { error } = await client().auth.verifyOtp({ email, token, type: "email" });
  if (error) throw new Error(error.message);
}

/** Leaves the page for Google and comes back to it signed in. */
export async function signInWithGoogle(): Promise<void> {
  const auth = client();
  // The redirect would land on a raw JSON error page if the provider is off,
  // so check the project's auth settings first.
  const settings = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "" },
  })
    .then((response) => (response.ok ? (response.json() as Promise<{ external?: Record<string, boolean> }>) : null))
    .catch(() => null);
  if (settings && !settings.external?.["google"]) throw new Error("Google sign-in isn't set up yet. Use the email code instead.");

  const { error } = await auth.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  const { error } = await client().auth.signOut();
  if (error) throw new Error(error.message);
}

/** Permanently delete the signed-in user's account and profile. */
export async function deleteAccount(): Promise<void> {
  const auth = client();
  // Storage objects don't cascade with the user, so remove saved take audio
  // first while the session can still read and delete it.
  const { data: user } = await auth.auth.getUser();
  if (user.user) {
    const { data: takes } = await auth.from("attempts").select("audio_path").eq("user_id", user.user.id).returns<{ audio_path: string }[]>();
    const paths = (takes ?? []).map((take) => take.audio_path);
    if (paths.length) await auth.storage.from("attempt-audio").remove(paths);
  }
  const { error } = await auth.rpc("delete_account");
  if (error) throw new Error(error.message);
  // The session's user no longer exists; clear it locally only.
  await auth.auth.signOut({ scope: "local" });
}

export async function fetchProfile(id: string): Promise<Profile | null> {
  const { data, error } = await client().from("profiles").select("id,display_name").eq("id", id).maybeSingle<Profile>();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateDisplayName(id: string, name: string): Promise<Profile> {
  const displayName = name.trim().slice(0, MAX_DISPLAY_NAME) || null;
  const { data, error } = await client().from("profiles").update({ display_name: displayName }).eq("id", id).select("id,display_name").single<Profile>();
  if (error) throw new Error(error.message);
  return data;
}

/** Up to two initials from a display name, falling back to the email. */
export function initials(name: string | null | undefined, email: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
  return (email ?? "?")[0]!.toUpperCase();
}
