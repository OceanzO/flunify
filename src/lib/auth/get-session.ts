import { cookies } from "next/headers";
import { DEMO_COOKIE, ROLE_COOKIE } from "../constants";
import { isDemoEnabled } from "../env";
import { createSupabaseServerClient } from "../supabase/server";
import type { Session } from "../types";
import { demoUserFromCookie, resolveActiveRole, userFromSupabase } from "./session";

/** Membaca sesi aktif di Server Component / layout. Supabase diprioritaskan di atas Mode Demo. */
export async function getServerSession(): Promise<Session | null> {
  const store = await cookies();
  const roleCookie = store.get(ROLE_COOKIE)?.value;

  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const user = userFromSupabase(data.user);
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", data.user.id)
          .maybeSingle();
        if (profile?.full_name) {
          user.fullName = profile.full_name;
        }
      } catch {
        // Fallback ke user_metadata jika query gagal
      }
      return { user, mode: "supabase", activeRole: resolveActiveRole(user, "supabase", roleCookie) };
    }
  }

  if (isDemoEnabled) {
    const user = demoUserFromCookie(store.get(DEMO_COOKIE)?.value);
    if (user) return { user, mode: "demo", activeRole: resolveActiveRole(user, "demo", roleCookie) };
  }

  return null;
}
