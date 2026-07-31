import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "./database.types";
import { isSupabaseConfigured, supabase } from "./supabase";

type AuthContextValue = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  authMessage: string | null;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  refreshAuth: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function fallbackName(email?: string | null) {
  if (!email) return "メンバー";
  return email.split("@")[0] || email;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const loadProfile = useCallback(async (currentUser: User | null) => {
    if (!supabase || !currentUser) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) {
      setAuthMessage("プロフィール情報を確認できませんでした。");
      setProfile(null);
      return;
    }

    setProfile(
      data ?? {
        id: currentUser.id,
        email: currentUser.email ?? "",
        display_name: fallbackName(currentUser.email),
        status: "active",
        created_at: currentUser.created_at,
        updated_at: currentUser.updated_at ?? currentUser.created_at,
      },
    );

    if (data?.status === "disabled") {
      setAuthMessage("このアカウントは現在停止されています。");
    } else {
      setAuthMessage(null);
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      await supabase.auth.refreshSession();
    }

    const {
      data: { user: currentUser },
      error,
    } = await supabase.auth.getUser();

    if (error || !currentUser) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    setUser(currentUser);
    await loadProfile(currentUser);
    setLoading(false);
  }, [loadProfile]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    void refreshAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      void loadProfile(nextUser);
    });

    return () => subscription.unsubscribe();
  }, [loadProfile, refreshAuth]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw new Error(error.message);
      }

      await refreshAuth();
    },
    [refreshAuth],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const setPassword = useCallback(async (password: string) => {
    if (!supabase) return;
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      throw new Error(error.message);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      authMessage,
      isAdmin:
        profile?.status !== "disabled" && user?.app_metadata?.role === "admin",
      signIn,
      signOut,
      setPassword,
      refreshAuth,
    }),
    [
      authMessage,
      loading,
      profile?.status,
      profile,
      refreshAuth,
      setPassword,
      signIn,
      signOut,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return value;
}
