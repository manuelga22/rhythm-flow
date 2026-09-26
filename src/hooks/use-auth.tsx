import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { fetchProfile, profileKey, type Profile } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type AuthContextValue = {
  user: User | null;
  profile: Profile | null;
  /** True until the stored session has been read; always true during SSR. */
  loading: boolean;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  openSheet: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [sheetOpen, setSheetOpen] = useState(false);

  // Runs only in the browser, where the session lives in localStorage.
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (event === "SIGNED_OUT") queryClient.removeQueries({ queryKey: ["profile"] });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const { data: profile } = useQuery({
    queryKey: profileKey(user?.id ?? ""),
    queryFn: () => fetchProfile(user!.id),
    enabled: Boolean(user),
    staleTime: Infinity,
  });

  const openSheet = useCallback(() => setSheetOpen(true), []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, profile: user ? (profile ?? null) : null, loading, sheetOpen, setSheetOpen, openSheet }),
    [user, profile, loading, sheetOpen, openSheet],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
