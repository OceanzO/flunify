"use client";

import { useMemo } from "react";
import { isSupabaseConfigured } from "../env";
import { getSupabaseBrowserClient } from "../supabase/client";
import { demoRepository } from "./demo-repository";
import type { Repository } from "./repository";
import { createSupabaseRepository } from "./supabase-repository";

export function useRepository(): Repository {
  return useMemo(() => {
    const supabase = getSupabaseBrowserClient();
    if (isSupabaseConfigured && supabase) {
      return createSupabaseRepository(supabase);
    }
    return demoRepository;
  }, []);
}
