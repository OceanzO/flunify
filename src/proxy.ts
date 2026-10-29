import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, homeFor, ROLE_COOKIE } from "./lib/constants";
import { isDemoEnabled, isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "./lib/env";
import { demoUserFromCookie, resolveActiveRole, userFromSupabase } from "./lib/auth/session";
import type { Role } from "./lib/types";

const THERAPIST_PREFIXES = ["/dashboard", "/assessments"];
const ADMIN_PREFIX = "/admin";

/**
 * Proxy (pengganti middleware di Next.js 16):
 * - Menyegarkan token Supabase di setiap request.
 * - Belum login  → paksa ke /login.
 * - Sudah login  → /login dan / diarahkan ke dashboard sesuai peran aktif.
 * - Mode Terapis tidak boleh membuka /admin, Mode Admin diarahkan ke /admin.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const roleCookie = request.cookies.get(ROLE_COOKIE)?.value;
  let activeRole: Role | null = null;

  if (isSupabaseConfigured) {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) activeRole = resolveActiveRole(userFromSupabase(user), "supabase", roleCookie);
    } catch {
      // Token kedaluwarsa atau tidak valid di Supabase Auth, lanjut sebagai tamu
    }
  }

  if (!activeRole && isDemoEnabled) {
    const demoUser = demoUserFromCookie(request.cookies.get(DEMO_COOKIE)?.value);
    if (demoUser) activeRole = resolveActiveRole(demoUser, "demo", roleCookie);
  }

  const { pathname, searchParams } = request.nextUrl;

  // Rute darurat /logout atau ?logout=1 untuk membersihkan cookie sesi kapan saja.
  if (pathname === "/logout" || (pathname === "/login" && searchParams.has("logout"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const res = NextResponse.redirect(url);
    res.cookies.delete(DEMO_COOKIE);
    res.cookies.delete(ROLE_COOKIE);
    request.cookies.getAll().forEach((c) => {
      if (c.name.startsWith("sb-") || c.name === DEMO_COOKIE || c.name === ROLE_COOKIE) {
        res.cookies.delete(c.name);
      }
    });
    return res;
  }

  const redirectTo = (path: string, next?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = next ? `?next=${encodeURIComponent(next)}` : "";
    const res = NextResponse.redirect(url);
    // Pertahankan cookie sesi Supabase yang baru disegarkan.
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (!activeRole) {
    if (pathname === "/login") return response;
    return redirectTo("/login", pathname === "/" ? undefined : pathname);
  }

  if (pathname === "/" || pathname === "/login") return redirectTo(homeFor(activeRole));

  if (pathname.startsWith(ADMIN_PREFIX) && activeRole !== "admin") return redirectTo("/dashboard");

  if (THERAPIST_PREFIXES.some((p) => pathname.startsWith(p)) && activeRole === "admin") {
    return redirectTo("/admin");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
