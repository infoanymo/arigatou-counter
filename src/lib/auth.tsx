import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
const authRequestTimeoutMs = 8_000;

class AuthRequestTimeoutError extends Error {
  constructor() {
    super("認証サーバーから応答がありません。時間をおいて再度お試しください。");
    this.name = "AuthRequestTimeoutError";
  }
}

async function withAuthTimeout<T>(operation: PromiseLike<T>): Promise<T> {
  let timeoutId: number | undefined;

  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new AuthRequestTimeoutError()),
          authRequestTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function fallbackName(email?: string | null) {
  if (!email) return "メンバー";
  return email.split("@")[0] || email;
}

function collectAuthParamsFromUrl() {
  const params = new URLSearchParams();

  function appendAll(value: string) {
    const cleanValue = value.replace(/^[?#]/, "");
    if (!cleanValue || !cleanValue.includes("=")) return;

    const nextParams = new URLSearchParams(cleanValue);
    nextParams.forEach((paramValue, key) => {
      params.set(key, paramValue);
    });
  }

  appendAll(window.location.search);

  for (const fragment of window.location.href.split("#").slice(1)) {
    appendAll(fragment);

    const routeQueryStart = fragment.indexOf("?");
    if (routeQueryStart >= 0) {
      appendAll(fragment.slice(routeQueryStart + 1));
    }
  }

  return params;
}

function cleanPasswordSetupUrl() {
  window.history.replaceState(
    null,
    "",
    `${window.location.origin}${window.location.pathname}#/login?mode=set-password`,
  );
}

async function recoverNestedHashSession() {
  if (!supabase) return;

  const params = collectAuthParamsFromUrl();
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (tokenHash && (type === "invite" || type === "recovery")) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) cleanPasswordSetupUrl();
    return;
  }

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (!error) cleanPasswordSetupUrl();
    return;
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) cleanPasswordSetupUrl();
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const profileRequestIdRef = useRef(0);

  const loadProfile = useCallback(async (currentUser: User | null) => {
    const requestId = ++profileRequestIdRef.current;

    if (!supabase || !currentUser) {
      setProfile(null);
      return;
    }

    let result;
    try {
      result = await withAuthTimeout(
        supabase
          .from("profiles")
          .select("*")
          .eq("id", currentUser.id)
          .maybeSingle(),
      );
    } catch (error) {
      if (requestId !== profileRequestIdRef.current) return;
      setAuthMessage(
        error instanceof AuthRequestTimeoutError
          ? error.message
          : "プロフィール情報を確認できませんでした。",
      );
      return;
    }

    if (requestId !== profileRequestIdRef.current) return;
    const { data, error } = result;

    if (error) {
      setAuthMessage("プロフィール情報を確認できませんでした。");
      return;
    }

    setProfile(
      data ?? {
        id: currentUser.id,
        email: currentUser.email ?? "",
        display_name: fallbackName(currentUser.email),
        company_name: null,
        avatar_url: null,
        avatar_scale: 100,
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
    try {
      await withAuthTimeout(recoverNestedHashSession());

      const {
        data: { session },
        error,
      } = await withAuthTimeout(supabase.auth.getSession());

      if (error) throw error;

      const currentUser = session?.user ?? null;
      if (!currentUser) {
        setUser(null);
        setProfile(null);
        setAuthMessage(null);
        return;
      }

      setUser(currentUser);
      await loadProfile(currentUser);
    } catch (error) {
      setAuthMessage(
        error instanceof AuthRequestTimeoutError
          ? error.message
          : "ログイン状態を確認できませんでした。再度お試しください。",
      );
    } finally {
      setLoading(false);
    }
  }, [loadProfile]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      void refreshAuth();
    }

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
      setAuthMessage(null);
      const { data, error } = await withAuthTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
      );

      if (error) {
        throw new Error(error.message);
      }

      const currentUser = data.user ?? data.session?.user ?? null;
      if (!currentUser) {
        throw new Error("ログイン情報を確認できませんでした。再度お試しください。");
      }

      setUser(currentUser);
      await loadProfile(currentUser);
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const setPassword = useCallback(async (password: string) => {
    if (!supabase) return;
    const { error } = await withAuthTimeout(
      supabase.auth.updateUser({ password }),
    );
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
