"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_CREDENTIALS, DEMO_COOKIE, DEMO_USERS, homeFor, ROLE_COOKIE } from "@/lib/constants";
import { isDemoEnabled, isSupabaseConfigured } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { demoRepository } from "@/lib/data/demo-repository";
import { canUseRole, safeNextPath, userFromSupabase } from "./session";
import type { Role, Session } from "@/lib/types";

interface SignInResult {
  error?: string;
}

interface AuthContextValue {
  session: Session | null;
  isDemoEnabled: boolean;
  isSupabaseConfigured: boolean;
  canSwitchRole: boolean;
  signInWithPassword: (usernameOrEmail: string, password: string, role: Role, next?: string | null) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  switchRole: (role: Role) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const WEEK_SECONDS = 60 * 60 * 24 * 7;

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${WEEK_SECONDS}; SameSite=Lax`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Navigasi penuh setelah perubahan sesi agar proxy & server layout
 * selalu membaca cookie terbaru.
 */
function hardNavigate(path: string) {
  window.location.assign(path);
}

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "Username atau kata sandi tidak valid.";
  if (m.includes("email not confirmed")) return "Akun belum dikonfirmasi. Periksa kotak masuk email Anda.";
  if (m.includes("rate limit") || m.includes("too many")) return "Terlalu banyak percobaan login. Coba lagi dalam beberapa saat.";
  if (m.includes("fetch")) return "Tidak dapat terhubung ke server database. Periksa koneksi internet.";
  return message;
}

export function AuthProvider({ initialSession, children }: { initialSession: Session | null; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(initialSession);

  useEffect(() => setSession(initialSession), [initialSession]);

  // Sinkronkan logout dari tab lain / token kedaluwarsa (khusus Supabase).
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || session?.mode !== "supabase") return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") hardNavigate("/login");
    });
    return () => data.subscription.unsubscribe();
  }, [session?.mode]);

  const signInWithPassword = useCallback<AuthContextValue["signInWithPassword"]>(
    async (usernameOrEmail, password, role, next) => {
      const destination = safeNextPath(next) ?? homeFor(role);
      const supabase = getSupabaseBrowserClient();
      const trimmed = usernameOrEmail.trim().toLowerCase();
      const normalizedEmail = trimmed.includes("@") ? trimmed : `${trimmed}@flunify.id`;
      const clientUA = typeof navigator !== "undefined" ? navigator.userAgent : "Browser";

      if (supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (data.user && !error) {
          const user = userFromSupabase(data.user);
          if (!canUseRole(user, "supabase", role)) {
            await supabase.auth.signOut();
            await demoRepository.recordLoginLog?.({
              username: trimmed,
              role,
              status: "failed",
              ipAddress: "127.0.0.1",
              userAgent: clientUA,
              message: "Akses ditolak: role tidak sesuai",
            });
            return {
              error:
                role === "admin"
                  ? "Akun ini adalah Terapis Wicara. Silakan klik tab 'Terapis' di atas untuk masuk."
                  : "Akun ini adalah Administrator. Silakan klik tab 'Admin' di atas untuk masuk.",
            };
          }
          await demoRepository.recordLoginLog?.({
            username: trimmed,
            fullName: user.fullName,
            role,
            status: "success",
            ipAddress: "127.0.0.1",
            userAgent: clientUA,
            message: "Autentikasi Supabase berhasil",
          });
          clearCookie(DEMO_COOKIE);
          setCookie(ROLE_COOKIE, role);
          hardNavigate(role === "admin" ? homeFor(role) : destination);
          return {};
        }
      }

      // 1. Cek akun dinamis dari penyimpanan lokal (localStorage) terlebih dahulu:
      let matchedRole: Role | null = null;
      let matchedName = "";

      try {
        const raw = window.localStorage.getItem("fc_demo_users");
        if (raw) {
          const storedUsers: Array<{
            fullName: string;
            username: string;
            email: string;
            password?: string;
            accountType: string;
            status: string;
          }> = JSON.parse(raw);
          const found = storedUsers.find(
            (u) =>
              u.status === "active" &&
              (u.username?.toLowerCase() === trimmed ||
                u.email?.toLowerCase() === normalizedEmail ||
                u.email?.toLowerCase() === trimmed) &&
              (u.password === password ||
                (!u.password &&
                  password ===
                    (u.accountType === "admin"
                      ? DEFAULT_CREDENTIALS.admin.password
                      : DEFAULT_CREDENTIALS.therapist.password)))
          );
          if (found) {
            matchedRole = found.accountType === "admin" ? "admin" : "therapist";
            matchedName = found.fullName;
          }
        }
      } catch {}

      // 2. Fallback cadangan ke akun bawaan sistem jika belum ada di localStorage:
      if (!matchedRole) {
        if (
          (trimmed === DEFAULT_CREDENTIALS.admin.username.toLowerCase() ||
            trimmed === DEFAULT_CREDENTIALS.admin.email.toLowerCase() ||
            normalizedEmail === DEFAULT_CREDENTIALS.admin.email.toLowerCase()) &&
          password === DEFAULT_CREDENTIALS.admin.password
        ) {
          matchedRole = "admin";
          matchedName = DEFAULT_CREDENTIALS.admin.fullName;
        } else if (
          (trimmed === DEFAULT_CREDENTIALS.therapist.username.toLowerCase() ||
            trimmed === DEFAULT_CREDENTIALS.therapist.email.toLowerCase() ||
            normalizedEmail === DEFAULT_CREDENTIALS.therapist.email.toLowerCase()) &&
          password === DEFAULT_CREDENTIALS.therapist.password
        ) {
          matchedRole = "therapist";
          matchedName = DEFAULT_CREDENTIALS.therapist.fullName;
        }
      }

      if (!matchedRole) {
        await demoRepository.recordLoginLog?.({
          username: trimmed,
          role,
          status: "failed",
          ipAddress: "127.0.0.1 (Lokal)",
          userAgent: clientUA,
          message: "Username atau kata sandi tidak cocok",
        });
        return { error: "Username atau kata sandi tidak valid. Silakan periksa kembali." };
      }

      // Validasi ketat: Terapis hanya boleh masuk di tab Terapis, Admin hanya di tab Admin
      if (role === "admin" && matchedRole !== "admin") {
        await demoRepository.recordLoginLog?.({
          username: trimmed,
          role,
          status: "failed",
          ipAddress: "127.0.0.1 (Lokal)",
          userAgent: clientUA,
          message: "Akses ditolak: akun bukan admin",
        });
        return { error: "Akun ini adalah Terapis Wicara. Silakan klik tab 'Terapis' di atas untuk masuk." };
      }

      if (role === "therapist" && matchedRole !== "therapist") {
        await demoRepository.recordLoginLog?.({
          username: trimmed,
          role,
          status: "failed",
          ipAddress: "127.0.0.1 (Lokal)",
          userAgent: clientUA,
          message: "Akses ditolak: akun bukan terapis",
        });
        return { error: "Akun ini adalah Administrator. Silakan klik tab 'Admin' di atas untuk masuk." };
      }

      await demoRepository.recordLoginLog?.({
        username: trimmed,
        fullName: matchedName,
        role: matchedRole,
        status: "success",
        ipAddress: "127.0.0.1 (Lokal)",
        userAgent: clientUA,
        message: "Login berhasil",
      });

      setCookie(DEMO_COOKIE, matchedRole);
      setCookie(ROLE_COOKIE, role);
      hardNavigate(role === "admin" ? homeFor(role) : destination);
      return {};
    },
    []
  );

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (supabase && session?.mode === "supabase") await supabase.auth.signOut();
    clearCookie(DEMO_COOKIE);
    clearCookie(ROLE_COOKIE);
    hardNavigate("/login");
  }, [session?.mode]);

  const switchRole = useCallback((role: Role) => {
    // Role switcher dinonaktifkan di tampilan utama sesuai kebijakan hak akses terpisah.
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isDemoEnabled,
      isSupabaseConfigured,
      canSwitchRole: false, // Tidak dapat di-switch di dashboard utama
      signInWithPassword,
      signOut,
      switchRole,
    }),
    [session, signInWithPassword, signOut, switchRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>.");
  return ctx;
}

/** Untuk halaman terproteksi — sesi dijamin ada oleh proxy & layout server. */
export function useSession(): Session {
  const { session } = useAuth();
  if (!session) throw new Error("Sesi tidak ditemukan.");
  return session;
}
